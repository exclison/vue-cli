const path = require('path')
const debug = require('debug')
const inquirer = require('inquirer')//命令行交互
const EventEmitter = require('events')//nodejs 的事件
const Generator = require('./Generator')
const cloneDeep = require('lodash.clonedeep')//lodash库 深拷贝
const sortObject = require('./util/sortObject')
const getVersions = require('./util/getVersions')
const PackageManager = require('./util/ProjectPackageManager')
const { clearConsole } = require('./util/clearConsole')
const PromptModuleAPI = require('./PromptModuleAPI')
const writeFileTree = require('./util/writeFileTree')
const { formatFeatures } = require('./util/features')
const loadLocalPreset = require('./util/loadLocalPreset')
const loadRemotePreset = require('./util/loadRemotePreset')
const generateReadme = require('./util/generateReadme')
const { resolvePkg, isOfficialPlugin } = require('@vue/cli-shared-utils')

const {
  defaults,
  saveOptions,
  loadOptions,
  savePreset,
  validatePreset,
  rcPath
} = require('./options')

const {
  chalk,
  execa,

  log,
  warn,
  error,

  hasGit,
  hasProjectGit,
  hasYarn,
  hasPnpm3OrLater,
  hasPnpmVersionOrLater,

  exit,
  loadModule
} = require('@vue/cli-shared-utils')

const isManualMode = answers => answers.preset === '__manual__'

module.exports = class Creator extends EventEmitter {
  constructor (name, context, promptModules) {
    //name 项目名   context 项目路径   promptModules 需要安装的模块配置
    super()

    this.name = name
    this.context = process.env.VUE_CLI_CONTEXT = context
    //获取默认或缓存配置提示(vue版本)
    const { presetPrompt, featurePrompt } = this.resolveIntroPrompts()

    this.presetPrompt = presetPrompt//预设提示
    this.featurePrompt = featurePrompt//功能提示
    //加载另外的一些配置提示 (包管理器 Babel Eslint等)
    this.outroPrompts = this.resolveOutroPrompts()
    this.injectedPrompts = []
    this.promptCompleteCbs = []
    this.afterInvokeCbs = []
    this.afterAnyInvokeCbs = []

    this.run = this.run.bind(this)

    const promptAPI = new PromptModuleAPI(this)
    promptModules.forEach(m => m(promptAPI))
  }

  async create (cliOptions = {}, preset = null) {
    const isTestOrDebug = process.env.VUE_CLI_TEST || process.env.VUE_CLI_DEBUG
    const { run, name, context, afterInvokeCbs, afterAnyInvokeCbs } = this

    if (!preset) {
      if (cliOptions.preset) {
        // vue create foo --preset bar
        preset = await this.resolvePreset(cliOptions.preset, cliOptions.clone)
      } else if (cliOptions.default) {
        // vue create foo --default
        preset = defaults.presets.default
      } else if (cliOptions.inlinePreset) {
        // vue create foo --inlinePreset {...}
        try {
          preset = JSON.parse(cliOptions.inlinePreset)
        } catch (e) {
          error(`CLI inline preset is not valid JSON: ${cliOptions.inlinePreset}`)
          exit(1)
        }
      } else {
        preset = await this.promptAndResolvePreset()
      }
    }

    // clone before mutating
    preset = cloneDeep(preset)
    // inject core service
    preset.plugins['@vue/cli-service'] = Object.assign({
      projectName: name
    }, preset)

    if (cliOptions.bare) {
      preset.plugins['@vue/cli-service'].bare = true
    }

    // legacy support for router
    if (preset.router) {
      preset.plugins['@vue/cli-plugin-router'] = {}

      if (preset.routerHistoryMode) {
        preset.plugins['@vue/cli-plugin-router'].historyMode = true
      }
    }

    // Introducing this hack because typescript plugin must be invoked after router.
    // Currently we rely on the `plugins` object enumeration order,
    // which depends on the order of the field initialization.
    // FIXME: Remove this ugly hack after the plugin ordering API settled down
    if (preset.plugins['@vue/cli-plugin-router'] && preset.plugins['@vue/cli-plugin-typescript']) {
      const tmp = preset.plugins['@vue/cli-plugin-typescript']
      delete preset.plugins['@vue/cli-plugin-typescript']
      preset.plugins['@vue/cli-plugin-typescript'] = tmp
    }

    // legacy support for vuex
    if (preset.vuex) {
      preset.plugins['@vue/cli-plugin-vuex'] = {}
    }

    const packageManager = (
      cliOptions.packageManager ||
      loadOptions().packageManager ||
      (hasYarn() ? 'yarn' : null) ||
      (hasPnpm3OrLater() ? 'pnpm' : 'npm')
    )

    await clearConsole()
    const pm = new PackageManager({ context, forcePackageManager: packageManager })

    log(`✨  Creating project in ${chalk.yellow(context)}.`)
    this.emit('creation', { event: 'creating' })

    // get latest CLI plugin version
    const { latestMinor } = await getVersions()

    // generate package.json with plugin dependencies
    const pkg = {
      name,
      version: '0.1.0',
      private: true,
      devDependencies: {},
      ...resolvePkg(context)
    }
    const deps = Object.keys(preset.plugins)
    deps.forEach(dep => {
      if (preset.plugins[dep]._isPreset) {
        return
      }

      let { version } = preset.plugins[dep]

      if (!version) {
        if (isOfficialPlugin(dep) || dep === '@vue/cli-service' || dep === '@vue/babel-preset-env') {
          version = isTestOrDebug ? `latest` : `~${latestMinor}`
        } else {
          version = 'latest'
        }
      }

      pkg.devDependencies[dep] = version
    })

    // write package.json
    await writeFileTree(context, {
      'package.json': JSON.stringify(pkg, null, 2)
    })

    // generate a .npmrc file for pnpm, to persist the `shamefully-flatten` flag
    if (packageManager === 'pnpm') {
      const pnpmConfig = hasPnpmVersionOrLater('4.0.0')
        ? 'shamefully-hoist=true\n'
        : 'shamefully-flatten=true\n'

      await writeFileTree(context, {
        '.npmrc': pnpmConfig
      })
    }

    // intilaize git repository before installing deps
    // so that vue-cli-service can setup git hooks.
    const shouldInitGit = this.shouldInitGit(cliOptions)
    if (shouldInitGit) {
      log(`🗃  Initializing git repository...`)
      this.emit('creation', { event: 'git-init' })
      await run('git init')
    }

    // install plugins
    log(`⚙\u{fe0f}  Installing CLI plugins. This might take a while...`)
    log()
    this.emit('creation', { event: 'plugins-install' })

    if (isTestOrDebug && !process.env.VUE_CLI_TEST_DO_INSTALL_PLUGIN) {
      // in development, avoid installation process
      await require('./util/setupDevProject')(context)
    } else {
      await pm.install()
    }

    // run generator
    log(`🚀  Invoking generators...`)
    this.emit('creation', { event: 'invoking-generators' })
    const plugins = await this.resolvePlugins(preset.plugins, pkg)
    const generator = new Generator(context, {
      pkg,
      plugins,
      afterInvokeCbs,
      afterAnyInvokeCbs
    })
    await generator.generate({
      extractConfigFiles: preset.useConfigFiles
    })

    // install additional deps (injected by generators)
    log(`📦  Installing additional dependencies...`)
    this.emit('creation', { event: 'deps-install' })
    log()
    if (!isTestOrDebug || process.env.VUE_CLI_TEST_DO_INSTALL_PLUGIN) {
      await pm.install()
    }

    // run complete cbs if any (injected by generators)
    log(`⚓  Running completion hooks...`)
    this.emit('creation', { event: 'completion-hooks' })
    for (const cb of afterInvokeCbs) {
      await cb()
    }
    for (const cb of afterAnyInvokeCbs) {
      await cb()
    }

    if (!generator.files['README.md']) {
      // generate README.md
      log()
      log('📄  Generating README.md...')
      await writeFileTree(context, {
        'README.md': generateReadme(generator.pkg, packageManager)
      })
    }

    // commit initial state
    let gitCommitFailed = false
    if (shouldInitGit) {
      await run('git add -A')
      if (isTestOrDebug) {
        await run('git', ['config', 'user.name', 'test'])
        await run('git', ['config', 'user.email', 'test@test.com'])
        await run('git', ['config', 'commit.gpgSign', 'false'])
      }
      const msg = typeof cliOptions.git === 'string' ? cliOptions.git : 'init'
      try {
        await run('git', ['commit', '-m', msg, '--no-verify'])
      } catch (e) {
        gitCommitFailed = true
      }
    }

    // log instructions
    log()
    log(`🎉  Successfully created project ${chalk.yellow(name)}.`)
    if (!cliOptions.skipGetStarted) {
      log(
        `👉  Get started with the following commands:\n\n` +
        (this.context === process.cwd() ? `` : chalk.cyan(` ${chalk.gray('$')} cd ${name}\n`)) +
        chalk.cyan(` ${chalk.gray('$')} ${packageManager === 'yarn' ? 'yarn serve' : packageManager === 'pnpm' ? 'pnpm run serve' : 'npm run serve'}`)
      )
    }
    log()
    this.emit('creation', { event: 'done' })

    if (gitCommitFailed) {
      warn(
        `Skipped git commit due to missing username and email in git config, or failed to sign commit.\n` +
        `You will need to perform the initial commit yourself.\n`
      )
    }

    generator.printExitLogs()
  }
  //用于执行指令的函数 run('git clone https://www.github.com/exclison')
  run (command, args) {
    if (!args) { [command, ...args] = command.split(/\s+/) }
    return execa(command, args, { cwd: this.context })//command:指令,cwd:子进程当前工作的目录
  }

  async promptAndResolvePreset (answers = null) {
    // prompt
    if (!answers) {
      await clearConsole(true)
      answers = await inquirer.prompt(this.resolveFinalPrompts())
    }
    debug('vue-cli:answers')(answers)

    if (answers.packageManager) {
      saveOptions({
        packageManager: answers.packageManager
      })
    }

    let preset
    if (answers.preset && answers.preset !== '__manual__') {
      preset = await this.resolvePreset(answers.preset)
    } else {
      // manual
      preset = {
        useConfigFiles: answers.useConfigFiles === 'files',
        plugins: {}
      }
      answers.features = answers.features || []
      // run cb registered by prompt modules to finalize the preset
      this.promptCompleteCbs.forEach(cb => cb(answers, preset))
    }

    // validate
    validatePreset(preset)

    // save preset
    if (answers.save && answers.saveName && savePreset(answers.saveName, preset)) {
      log()
      log(`🎉  Preset ${chalk.yellow(answers.saveName)} saved in ${chalk.yellow(rcPath)}`)
    }

    debug('vue-cli:preset')(preset)
    return preset
  }

  async resolvePreset (name, clone) {
    let preset
    const savedPresets = this.getPresets()

    if (name in savedPresets) {
      preset = savedPresets[name]
    } else if (name.endsWith('.json') || /^\./.test(name) || path.isAbsolute(name)) {
      preset = await loadLocalPreset(path.resolve(name))
    } else if (name.includes('/')) {
      log(`Fetching remote preset ${chalk.cyan(name)}...`)
      this.emit('creation', { event: 'fetch-remote-preset' })
      try {
        preset = await loadRemotePreset(name, clone)
      } catch (e) {
        error(`Failed fetching remote preset ${chalk.cyan(name)}:`)
        throw e
      }
    }

    if (!preset) {
      error(`preset "${name}" not found.`)
      const presets = Object.keys(savedPresets)
      if (presets.length) {
        log()
        log(`available presets:\n${presets.join(`\n`)}`)
      } else {
        log(`you don't seem to have any saved preset.`)
        log(`run vue-cli in manual mode to create a preset.`)
      }
      exit(1)
    }
    return preset
  }

  // { id: options } => [{ id, apply, options }]
  async resolvePlugins (rawPlugins, pkg) {
    // ensure cli-service is invoked first
    rawPlugins = sortObject(rawPlugins, ['@vue/cli-service'], true)
    const plugins = []
    for (const id of Object.keys(rawPlugins)) {
      const apply = loadModule(`${id}/generator`, this.context) || (() => {})
      let options = rawPlugins[id] || {}

      if (options.prompts) {
        let pluginPrompts = loadModule(`${id}/prompts`, this.context)

        if (pluginPrompts) {
          const prompt = inquirer.createPromptModule()

          if (typeof pluginPrompts === 'function') {
            pluginPrompts = pluginPrompts(pkg, prompt)
          }
          if (typeof pluginPrompts.getPrompts === 'function') {
            pluginPrompts = pluginPrompts.getPrompts(pkg, prompt)
          }

          log()
          log(`${chalk.cyan(options._isPreset ? `Preset options:` : id)}`)
          options = await prompt(pluginPrompts)
        }
      }

      plugins.push({ id, apply, options })
    }
    return plugins
  }
  //获取预设配置
  getPresets () {
    const savedOptions = loadOptions()//本地缓存的配置
    //合并本地缓存的配置和默认配置
    return Object.assign({}, savedOptions.presets, defaults.presets)
  }
  //加载介绍提示
  resolveIntroPrompts () {
    //获取预设配置
    const presets = this.getPresets()
    //获取预设的选择项
    const presetChoices = Object.entries(presets).map(([name, preset]) => {
      let displayName = name
      if (name === 'default') {
        displayName = 'Default'
      } else if (name === '__default_vue_3__') {
        displayName = 'Default (Vue 3)'
      }

      return {
        name: `${displayName} (${formatFeatures(preset)})`,
        value: name
      }
    })
    //预设提示
    const presetPrompt = {
      name: 'preset',
      type: 'list',
      message: `Please pick a preset:`,
      choices: [
        ...presetChoices,//上边获取的配置选择项
        {
          name: 'Manually select features',//手动选择功能
          value: '__manual__'
        }
      ]
    }
    //功能提示
    const featurePrompt = {
      name: 'features',
      when: isManualMode,//当手册模式的时候
      type: 'checkbox',
      message: 'Check the features needed for your project:',//选择项目所需的功能
      choices: [],
      pageSize: 10
    }
    return {
      presetPrompt,
      featurePrompt
    }
  }
  //加载另外的一些提示 包管理器 或者 Babel Eslint等
  resolveOutroPrompts () {
    const outroPrompts = [
      {
        name: 'useConfigFiles',
        when: isManualMode,//在手动模式
        type: 'list',
        //你喜欢把Babel, ESLint等的配置放在哪里?
        message: 'Where do you prefer placing config for Babel, ESLint, etc.?',
        choices: [
          {
            name: 'In dedicated config files',//在专用配置文件中
            value: 'files'
          },
          {
            name: 'In package.json',//在package.json
            value: 'pkg'
          }
        ]
      },
      {
        name: 'save',
        when: isManualMode,//手动模式
        type: 'confirm',
        //将其保存为将来项目的预设值
        message: 'Save this as a preset for future projects?',
        default: false
      },
      {
        name: 'saveName',
        when: answers => answers.save,
        type: 'input',
        message: 'Save preset as:'//保存预设为
      }
    ]

    // ask for packageManager once   请求一次packageManager
    const savedOptions = loadOptions()
    //获取包管理器的提示选项
    if (!savedOptions.packageManager && (hasYarn() || hasPnpm3OrLater())) {
      const packageManagerChoices = []

      if (hasYarn()) {
        packageManagerChoices.push({
          name: 'Use Yarn',
          value: 'yarn',
          short: 'Yarn'
        })
      }

      if (hasPnpm3OrLater()) {
        packageManagerChoices.push({
          name: 'Use PNPM',
          value: 'pnpm',
          short: 'PNPM'
        })
      }

      packageManagerChoices.push({
        name: 'Use NPM',
        value: 'npm',
        short: 'NPM'
      })

      outroPrompts.push({
        name: 'packageManager',
        type: 'list',
        //选择安装依赖项时要使用的包管理器
        message: 'Pick the package manager to use when installing dependencies:',
        choices: packageManagerChoices//包管理器选项
      })
    }

    return outroPrompts
  }

  resolveFinalPrompts () {
    // patch generator-injected prompts to only show in manual mode
    this.injectedPrompts.forEach(prompt => {
      const originalWhen = prompt.when || (() => true)
      prompt.when = answers => {
        return isManualMode(answers) && originalWhen(answers)
      }
    })

    const prompts = [
      this.presetPrompt,
      this.featurePrompt,
      ...this.injectedPrompts,
      ...this.outroPrompts
    ]
    debug('vue-cli:prompts')(prompts)
    return prompts
  }

  shouldInitGit (cliOptions) {
    if (!hasGit()) {
      return false
    }
    // --git
    if (cliOptions.forceGit) {
      return true
    }
    // --no-git
    if (cliOptions.git === false || cliOptions.git === 'false') {
      return false
    }
    // default: true unless already in a git repo
    return !hasProjectGit(this.context)
  }
}
