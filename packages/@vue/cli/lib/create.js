//fs-extra添加本机fs模块中未包含的文件系统方法，并为这些fs方法添加promise支持。它还graceful-fs用于防止EMFILE错误。应该是的替代品fs。
const fs = require('fs-extra')
const path = require('path')
//常见的交互式命令行用户界面的集合 其实就是创建项目的时候命令行提供的选项及问题,问你需要安装哪些插件
const inquirer = require('inquirer')
const Creator = require('./Creator')
const { clearConsole } = require('./util/clearConsole')
const { getPromptModules } = require('./util/createTools')
const { chalk, error, stopSpinner, exit } = require('@vue/cli-shared-utils')
//验证是否是有效的npm软件包名称
const validateProjectName = require('validate-npm-package-name') 

async function create (projectName, options) {
  /*
    options:{
      preset,
      default,
      inlinePreset,
      packageManager,
      registry,
      git,
      no,
      force,
      merge,
      clone,
      proxy,
      bare,
      skipGetStarted,
    }
    */

    //设置代理
  if (options.proxy) {
    process.env.HTTP_PROXY = options.proxy
  }
  //process.cwd() 方法会返回 Node.js 进程的当前工作目录
  const cwd = options.cwd || process.cwd()

  const inCurrent = projectName === '.'//项目名是否存在

  //path.relative() 方法根据当前工作目录返回 from 到 to 的相对路径。 如果 from 和 to 各自解析到相同的路径（分别调用 path.resolve() 之后），则返回零长度的字符串。
  const name = inCurrent ? path.relative('../', cwd) : projectName
  //绝对路径     path.resolve() 方法会将路径或路径片段的序列解析为绝对路径。
  const targetDir = path.resolve(cwd, projectName || '.')

  //验证是否是有效的npm软件包名称
  const result = validateProjectName(name)
  /*
   result值:
    {
      validForNewPackages: true,
      validForOldPackages: true
    }
  或
    {
    validForNewPackages: false,
    validForOldPackages: false,
    errors: [
      'name cannot contain leading or trailing spaces',
      'name can only contain URL-friendly characters'
      ]
    }
  或
    {
      validForNewPackages: false,
      validForOldPackages: true,
      warnings: [
        "name can no longer contain capital letters",
        "name can no longer contain more than 214 characters"
      ]
    }
  */
  if (!result.validForNewPackages) {
    //错误处理并退出进程
    console.error(chalk.red(`Invalid project name: "${name}"`))
    result.errors && result.errors.forEach(err => {
      console.error(chalk.red.dim('Error: ' + err))
    })
    result.warnings && result.warnings.forEach(warn => {
      console.error(chalk.red.dim('Warning: ' + warn))
    })
    exit(1)
  }
  //fs.existsSync 通过检查文件系统来测试给定路径是否存在
  // 路径存在并且没有合并目标路径的参数
  if (fs.existsSync(targetDir) && !options.merge) {
    //如果覆盖目标目录
    if (options.force) {
      //如果覆盖目标目录,就先删除目标目录
      await fs.remove(targetDir)
    } else {
      //不覆盖目标目录
      

      await clearConsole()
      //如果项目名是 '.' 并且不覆盖目标目录
      if (inCurrent) {
        const { ok } = await inquirer.prompt([
          {
            name: 'ok',
            type: 'confirm',
            message: `Generate project in current directory?`//在当前目录中生成项目?
          }
        ])
        if (!ok) {
          return
        }
      } else {
        //项目名不是 '.' 并且不覆盖目标目录
        const { action } = await inquirer.prompt([
          {
            name: 'action',
            type: 'list',
            //目标路径已经存在 请选择一个操作
            message: `Target directory ${chalk.cyan(targetDir)} already exists. Pick an action:`,
            choices: [
              { name: 'Overwrite', value: 'overwrite' }, //覆盖
              { name: 'Merge', value: 'merge' },//合并
              { name: 'Cancel', value: false }//取消
            ]
          }
        ])
        if (!action) {//取消
          return
        } else if (action === 'overwrite') {//覆盖
          //打印日志并移除文件夹
          console.log(`\nRemoving ${chalk.cyan(targetDir)}...`)
          await fs.remove(targetDir)
        }
      }
    }
  }

  const creator = new Creator(name, targetDir, getPromptModules())
  await creator.create(options)
}

module.exports = (...args) => {
  return create(...args).catch(err => {
    stopSpinner(false) // do not persist
    error(err)
    if (!process.env.VUE_CLI_TEST) {
      process.exit(1)
    }
  })
}
