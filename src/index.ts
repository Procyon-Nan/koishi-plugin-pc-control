import { Context, Schema, Session } from 'koishi'
import { spawn, ChildProcess, exec } from 'child_process'
import * as path from 'path'

export const name = 'pc-control'

export interface Config {
  allowUsers: string[]
  scripts: {
    name: string
    filepath: string
    description: string
  }[]
}

export const Config: Schema<Config> = Schema.object({
  allowUsers: Schema.array(String).description('可运行脚本的用户列表').required(),
  scripts: Schema.array(
    Schema.object({
      name: Schema.string().description('名称').required(),
      filepath: Schema.string().description('文件路径').required(),
      description: Schema.string().description('描述'),
    })
  ).description('脚本配置列表'),
})

export function apply(ctx: Context, config: Config) {
  const runningProcesses = new Map<string, ChildProcess>()
  const logger = ctx.logger('pc-control')

  const checkPermission = (session: Session): boolean => {
    if (!config.allowUsers.includes(session.userId)) {
      return false
    }
    return true
  }

  // 运行脚本
  ctx.command('pc.run <name:string>', '执行指定的本地脚本').action(async ({ session }, name) => {
    // 权限校验
    if (!checkPermission(session)) return '你没有执行此操作的权限'

    if (!name) return '请输入正确的脚本名称'
    const script = config.scripts.find(s => s.name === name)
    if (!script) return '没有此脚本'
    if (runningProcesses.has(name)) return `${name}已在运行中，请勿重复启动`

    try {
      session.send(`正在启动${name}...`)
      const child = spawn(script.filepath, [], {
        cwd: path.dirname(script.filepath),
        shell: true,
        detached: false,
        stdio: 'pipe',
      })
      if (!child.pid) throw new Error('启动失败，无法获取进程PID')

      runningProcesses.set(name, child)
      logger.info(`${name}已启动，PID: ${child.pid}`)

      // 监听日志
      child.stdout?.on('data', (data) => {
        const log = data.toString().trim()
        if (log) logger.info(`[${name}]: ${log}`)
      })

      child.stderr?.on('data', (data) => {
        const log = data.toString().trim()
        if (log) logger.warn(`[${name}]: ${log}`)
      })

      // 监听子进程退出
      child.on('exit', (code) => {
        runningProcesses.delete(name)
        session.send(`${name}已退出，退出码为${code}`)
      })

      child.on('error', (err) => {
        runningProcesses.delete(name)
        session.send(`${name}发生错误，错误码为${err.message}`)
      })

      return `${name}已启动`
    } catch (error) {
      return `启动${name}失败，错误码为${error.message}`
    }
  })

  // 检查脚本状态
  ctx.command('pc.status', '检查所有脚本运行状态').action(async ({ session }) => {
    // 权限校验
    if (!checkPermission(session)) return '你没有执行此操作的权限'
    if (config.scripts.length === 0) return '未配置任何脚本'

    const statusList = config.scripts.map(script => {
      const isRunning = runningProcesses.has(script.name)
      const pid = isRunning ? runningProcesses.get(script.name)?.pid : 'N/A'
      const stateText = isRunning ? '🟢运行中' : '⚪未运行'
      return `[${script.name}] | ${stateText} | PID: ${pid}`
    })

    return `当前脚本运行状态：\n${statusList.join('\n')}`
  })

  // 停止脚本
  ctx.command('pc.stop <name:string>', '停止指定脚本').action(async ({ session }, name) => {
    // 权限校验
    if (!checkPermission(session)) return '你没有执行此操作的权限'
    if (!name) return '请输入正确的脚本名称'
    const script = config.scripts.find(s => s.name === name)
    if (!script) return '没有此脚本'
    const child = runningProcesses.get(name)
    if (!child) return `${name}未运行`

    const pid = child.pid
    exec(`taskkill /pid ${pid} /T /F`, (error, stdout, stderr) => {
      if (error) {
        logger.error(`停止${name}失败，错误码为${error.message}`)
        //session.send(`停止${name}失败，错误码为${error.message}`)
      } else {
        logger.info(`正在停止${name}，PID: ${pid}`)
        //session.send(`正在停止${name}，PID: ${pid}`)
      }
    })
  })
}
