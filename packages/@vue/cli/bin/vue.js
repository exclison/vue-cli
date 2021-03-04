#!/usr/bin/env node

// Check node version before requiring/doing anything else
// The user may be on a very old node version

const { chalk, semver } = require('@vue/cli-shared-utils')//chalk设置输出命令行颜色的 semver用于测试版本号是否合法
const requiredVersion = require('../package.json').engines.node
const leven = require('leven')

function checkNodeVersion (wanted, id) {
  if (!semver.satisfies(process.version, wanted, { includePrerelease: true })) {
    console.log(chalk.red(
      'You are using Node ' + process.version + ', but this version of ' + id +
      ' requires Node ' + wanted + '.\nPlease upgrade your Node version.'
    ))
    process.exit(1)
  }
}

checkNodeVersion(requiredVersion, '@vue/cli')

const fs = require('fs')
const path = require('path')
const slash = require('slash')//将Windows反斜杠路径转换为斜杠路径：foo\\bar➔foo/bar
const minimist = require('minimist')//从命令行解析参数选项

// enter debug mode when creating test repo
if (
  slash(process.cwd()).indexOf('/packages/test') > 0 && (
    fs.existsSync(path.resolve(process.cwd(), '../@vue')) ||
    fs.existsSync(path.resolve(process.cwd(), '../../@vue'))
  )
) {
  process.env.VUE_CLI_DEBUG = true
}

const program = require('commander') //命令行工具
const loadCommand = require('../lib/util/loadCommand')

program
  .version(`@vue/cli ${require('../package').version}`)
  .usage('<command> [options]')

program
  .command('create <app-name>')
  .description('create a new project powered by vue-cli-service')//创建一个由vue-cli服务驱动的新项目
  .option('-p, --preset <presetName>', 'Skip prompts and use saved or remote preset')//跳过提示并使用已保存或远程预设
  .option('-d, --default', 'Skip prompts and use default preset')//跳过提示并使用默认预设
  .option('-i, --inlinePreset <json>', 'Skip prompts and use inline JSON string as preset')//跳过提示并使用内联 JSON 字符串作为预设
  .option('-m, --packageManager <command>', 'Use specified npm client when installing dependencies')//安装依赖项时使用指定的npm客户端
  .option('-r, --registry <url>', 'Use specified npm registry when installing dependencies (only for npm)')//安装依赖项时使用指定的npm注册表（仅限npm）
  .option('-g, --git [message]', 'Force git initialization with initial commit message')//强制git初始化与初始提交消息
  .option('-n, --no-git', 'Skip git initialization')//跳过git初始化
  .option('-f, --force', 'Overwrite target directory if it exists')//如果存在，则覆盖目标目录
  .option('--merge', 'Merge target directory if it exists')//如果存在合并目标目录
  .option('-c, --clone', 'Use git clone when fetching remote preset')//获取远程预设时使用 git 克隆
  .option('-x, --proxy <proxyUrl>', 'Use specified proxy when creating project')//创建项目时使用指定代理
  .option('-b, --bare', 'Scaffold project without beginner instructions')//没有初学者说明的脚手架项目
  .option('--skipGetStarted', 'Skip displaying "Get started" instructions')//跳过显示"开始"说明
  .action((name, options) => {
    if (minimist(process.argv.slice(3))._.length > 1) {
      //您提供了多个参数。第一个将用作应用程序的名称，其余的将被忽略。
      console.log(chalk.yellow('\n Info: You provided more than one argument. The first one will be used as the app\'s name, the rest are ignored.'))
    }
    // --git makes commander to default git to true
    // 强制git初始化与初始提交消息 设置forceGit 为true
    if (process.argv.includes('-g') || process.argv.includes('--git')) {
      options.forceGit = true
    }
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
    require('../lib/create')(name, options)
  })

program
  .command('add <plugin> [pluginOptions]')
  .description('install a plugin and invoke its generator in an already created project')
  .option('--registry <url>', 'Use specified npm registry when installing dependencies (only for npm)')
  .allowUnknownOption()
  .action((plugin) => {
    require('../lib/add')(plugin, minimist(process.argv.slice(3)))
  })

program
  .command('invoke <plugin> [pluginOptions]')
  .description('invoke the generator of a plugin in an already created project')
  .option('--registry <url>', 'Use specified npm registry when installing dependencies (only for npm)')
  .allowUnknownOption()
  .action((plugin) => {
    require('../lib/invoke')(plugin, minimist(process.argv.slice(3)))
  })

program
  .command('inspect [paths...]')
  .description('inspect the webpack config in a project with vue-cli-service')
  .option('--mode <mode>')
  .option('--rule <ruleName>', 'inspect a specific module rule')
  .option('--plugin <pluginName>', 'inspect a specific plugin')
  .option('--rules', 'list all module rule names')
  .option('--plugins', 'list all plugin names')
  .option('-v --verbose', 'Show full function definitions in output')
  .action((paths, options) => {
    require('../lib/inspect')(paths, options)
  })

program
  .command('serve')
  .description('alias of "npm run serve" in the current project')
  .allowUnknownOption()
  .action(() => {
    require('../lib/util/runNpmScript')('serve', process.argv.slice(3))
  })

program
  .command('build')
  .description('alias of "npm run serve" in the current project')
  .action((cmd) => {
    require('../lib/util/runNpmScript')('build', process.argv.slice(3))
  })

program
  .command('ui')
  .description('start and open the vue-cli ui')
  .option('-H, --host <host>', 'Host used for the UI server (default: localhost)')
  .option('-p, --port <port>', 'Port used for the UI server (by default search for available port)')
  .option('-D, --dev', 'Run in dev mode')
  .option('--quiet', `Don't output starting messages`)
  .option('--headless', `Don't open browser on start and output port`)
  .action((options) => {
    checkNodeVersion('>=8.6', 'vue ui')
    require('../lib/ui')(options)
  })

program
  .command('init <template> <app-name>')
  .description('generate a project from a remote template (legacy API, requires @vue/cli-init)')
  .option('-c, --clone', 'Use git clone when fetching remote template')
  .option('--offline', 'Use cached template')
  .action(() => {
    loadCommand('init', '@vue/cli-init')
  })

program
  .command('config [value]')
  .description('inspect and modify the config')
  .option('-g, --get <path>', 'get value from option')
  .option('-s, --set <path> <value>', 'set option value')
  .option('-d, --delete <path>', 'delete option from config')
  .option('-e, --edit', 'open config with default editor')
  .option('--json', 'outputs JSON result only')
  .action((value, options) => {
    require('../lib/config')(value, options)
  })

program
  .command('outdated')
  .description('(experimental) check for outdated vue cli service / plugins')
  .option('--next', 'Also check for alpha / beta / rc versions when upgrading')
  .action((options) => {
    require('../lib/outdated')(options)
  })

program
  .command('upgrade [plugin-name]')
  .description('(experimental) upgrade vue cli service / plugins')
  .option('-t, --to <version>', 'Upgrade <package-name> to a version that is not latest')
  .option('-f, --from <version>', 'Skip probing installed plugin, assuming it is upgraded from the designated version')
  .option('-r, --registry <url>', 'Use specified npm registry when installing dependencies')
  .option('--all', 'Upgrade all plugins')
  .option('--next', 'Also check for alpha / beta / rc versions when upgrading')
  .action((packageName, options) => {
    require('../lib/upgrade')(packageName, options)
  })

program
  .command('migrate [plugin-name]')
  .description('(experimental) run migrator for an already-installed cli plugin')
  .requiredOption('-f, --from <version>', 'The base version for the migrator to migrate from')
  .action((packageName, options) => {
    require('../lib/migrate')(packageName, options)
  })

program
  .command('info')
  .description('print debugging information about your environment')
  .action((cmd) => {
    console.log(chalk.bold('\nEnvironment Info:'))
    require('envinfo').run(
      {
        System: ['OS', 'CPU'],
        Binaries: ['Node', 'Yarn', 'npm'],
        Browsers: ['Chrome', 'Edge', 'Firefox', 'Safari'],
        npmPackages: '/**/{typescript,*vue*,@vue/*/}',
        npmGlobalPackages: ['@vue/cli']
      },
      {
        showNotFound: true,
        duplicates: true,
        fullTree: true
      }
    ).then(console.log)
  })

// output help information on unknown commands
program.on('command:*', ([cmd]) => {
  program.outputHelp()
  console.log(`  ` + chalk.red(`Unknown command ${chalk.yellow(cmd)}.`))
  console.log()
  suggestCommands(cmd)
  process.exitCode = 1
})

// add some useful info on help
program.on('--help', () => {
  console.log()
  console.log(`  Run ${chalk.cyan(`vue <command> --help`)} for detailed usage of given command.`)
  console.log()
})

program.commands.forEach(c => c.on('--help', () => console.log()))

// enhance common error messages
const enhanceErrorMessages = require('../lib/util/enhanceErrorMessages')

enhanceErrorMessages('missingArgument', argName => {
  return `Missing required argument ${chalk.yellow(`<${argName}>`)}.`
})

enhanceErrorMessages('unknownOption', optionName => {
  return `Unknown option ${chalk.yellow(optionName)}.`
})

enhanceErrorMessages('optionMissingArgument', (option, flag) => {
  return `Missing required argument for option ${chalk.yellow(option.flags)}` + (
    flag ? `, got ${chalk.yellow(flag)}` : ``
  )
})

program.parse(process.argv)

if (!process.argv.slice(2).length) {
  program.outputHelp()
}

function suggestCommands (unknownCommand) {
  const availableCommands = program.commands.map(cmd => cmd._name)

  let suggestion

  availableCommands.forEach(cmd => {
    const isBestMatch = leven(cmd, unknownCommand) < leven(suggestion || '', unknownCommand)
    if (leven(cmd, unknownCommand) < 3 && isBestMatch) {
      suggestion = cmd
    }
  })

  if (suggestion) {
    console.log(`  ` + chalk.red(`Did you mean ${chalk.yellow(suggestion)}?`))
  }
}
