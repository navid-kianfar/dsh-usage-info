/** `usageInfo` namespace dictionaries (the session-header readout and the usage settings card). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'readout.aria': '用量信息',
  'readout.title': '上下文占用与账户余额',
  'panel.title': '用量',

  'context.title': '上下文',
  'context.reading': '已用 {percent}',
  'context.figures': '{used} / {window}',
  'context.system': '系统提示词',
  'context.tools': '工具定义',
  'context.messages': '对话内容',
  'context.pending': '首次请求后显示',
  'context.approximate': '各部分为估算值，总量以服务端计数为准。',

  'balance.title': '余额',
  'balance.granted': '赠送额度',
  'balance.toppedUp': '充值余额',
  'balance.empty': '账户没有余额',
  'balance.suspended': '账户当前不可用',
  'balance.low': '余额偏低',
  'balance.refresh': '刷新余额',
  'balance.loading': '正在读取…',
  'balance.age.now': '刚刚更新',
  'balance.age.minutes': '{value} 分钟前',
  'balance.age.hours': '{value} 小时前',
  'balance.age.days': '{value} 天前',

  'settings.title': '用量信息',
  'settings.description': '在会话标题栏显示上下文占用和账户余额。余额由服务端读取，API 密钥不会进入浏览器。',
  'settings.provider': '余额来源',
  'settings.provider.none': '未挂载余额服务',
  'settings.status.ready': '就绪',
  'settings.status.notReady': '未就绪',
  'settings.showContext': '显示上下文占用',
  'settings.showContext.hint': '在会话标题栏显示上下文窗口的占用比例。',
  'settings.showBalance': '显示账户余额',
  'settings.showBalance.hint': '在会话标题栏显示账户余额。关闭后不再请求余额接口。',
  'settings.refreshInterval': '刷新间隔（秒）',
  'settings.refreshInterval.hint': '浏览器重新读取余额的间隔。多个标签页共用服务端缓存，因此不会成倍增加接口请求。',
  'settings.lowBalanceThreshold': '低余额提示',
  'settings.lowBalanceThreshold.hint': '余额低于或等于该值时高亮提示。留空则不提示。',
  'settings.lowBalanceThreshold.invalid': '请输入精确的十进制数字，例如 10.00。',
} satisfies Record<string, string>

/** The usageInfo namespace key union. */
export type UsageInfoKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'readout.aria': 'Usage information',
  'readout.title': 'Context usage and account balance',
  'panel.title': 'Usage',

  'context.title': 'Context',
  'context.reading': '{percent} used',
  'context.figures': '{used} / {window}',
  'context.system': 'System prompt',
  'context.tools': 'Tool definitions',
  'context.messages': 'Conversation',
  'context.pending': 'Shown after the first request',
  'context.approximate': 'Parts are estimated; the total is the provider’s own count.',

  'balance.title': 'Balance',
  'balance.granted': 'Granted',
  'balance.toppedUp': 'Topped up',
  'balance.empty': 'The account holds no balance',
  'balance.suspended': 'The account is currently unavailable',
  'balance.low': 'Balance is low',
  'balance.refresh': 'Refresh balance',
  'balance.loading': 'Reading…',
  'balance.age.now': 'Just updated',
  'balance.age.minutes': '{value} min ago',
  'balance.age.hours': '{value} h ago',
  'balance.age.days': '{value} d ago',

  'settings.title': 'Usage information',
  'settings.description': 'Show context occupancy and account balance in the session header. The balance is read on the host, so the API key never reaches the browser.',
  'settings.provider': 'Balance provider',
  'settings.provider.none': 'No balance provider is mounted',
  'settings.status.ready': 'Ready',
  'settings.status.notReady': 'Not ready',
  'settings.showContext': 'Show context occupancy',
  'settings.showContext.hint': 'Show how full the model’s context window is in the session header.',
  'settings.showBalance': 'Show account balance',
  'settings.showBalance.hint': 'Show the account balance in the session header. Off stops asking the provider entirely.',
  'settings.refreshInterval': 'Refresh interval (seconds)',
  'settings.refreshInterval.hint': 'How often the browser re-reads the balance. Tabs share one host-side reading, so open windows do not multiply requests.',
  'settings.lowBalanceThreshold': 'Low-balance warning',
  'settings.lowBalanceThreshold.hint': 'Warn once the balance reaches this figure. Blank disables the warning.',
  'settings.lowBalanceThreshold.invalid': 'Enter an exact decimal, such as 10.00.',
} satisfies Record<UsageInfoKey, string>
