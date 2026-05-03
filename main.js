const { Plugin, ItemView, Notice, Modal, Setting, PluginSettingTab } = require('obsidian');

const VIEW_TYPE = 'worklog-view';
const YEAR_VIEW_TYPE = 'worklog-year-view';
const CONFIG_FILE_NAME = 'config.json';
const DEFAULT_SETTINGS = {
  worklogFolder: 'worklog',
  dataFolder: '.obsidian/plugins/worklog/data',
  createMonthlyNote: false,
  taskTypes: [],
  defaultTaskTemplates: []
};

const CATEGORIES = [
  { id: 'feature', label: '3D开发', color: '#4a73c9', enabled: true, requiresLogIssue: false, sort: 0 },
  { id: 'design', label: '3D设计', color: '#f5822a', enabled: true, requiresLogIssue: false, sort: 1 },
  { id: 'documentation', label: '文档撰写', color: '#e84a62', enabled: true, requiresLogIssue: false, sort: 2 },
  { id: 'support', label: '开发/应用支持', color: '#6fbe3e', enabled: true, requiresLogIssue: true, sort: 3 },
  { id: 'management', label: '项目和任务管理', color: '#2fc1b2', enabled: true, requiresLogIssue: true, sort: 4 },
  { id: 'other', label: '其他任务', color: '#f2bf00', enabled: true, requiresLogIssue: true, sort: 5 },
  { id: 'bug', label: 'bug', color: '#234886', enabled: true, requiresLogIssue: true, sort: 6 }
];

const STATUSES = [
  { id: 'todo', label: '未开始' },
  { id: 'doing', label: '进行中' },
  { id: 'done', label: '已完成' },
  { id: 'paused', label: '暂停' },
  { id: 'cancelled', label: '取消' }
];

const CATEGORY_ORDER = ['feature', 'design', 'other', 'support', 'management', 'documentation', 'bug', 'blank', 'unknown'];
const CATEGORY_COLORS = {
  feature: '#4a73c9',
  design: '#f5822a',
  other: '#f2bf00',
  support: '#6fbe3e',
  management: '#2fc1b2',
  documentation: '#e84a62',
  bug: '#234886',
  blank: '#234886',
  unknown: '#8a94a6'
};
const FALLBACK_COLORS = ['#4a73c9', '#f5822a', '#f2bf00', '#6fbe3e', '#2fc1b2', '#e84a62', '#234886', '#8a94a6', '#8b5cf6', '#0ea5e9', '#84cc16', '#ef4444'];
const CATEGORY_BY_ID = new Map(CATEGORIES.map((category) => [category.id, category]));
const CATEGORY_ORDER_INDEX = new Map(CATEGORY_ORDER.map((id, index) => [id, index]));

function clean(value) {
  return String(value ?? '').trim();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function pad3(value) {
  return String(value).padStart(3, '0');
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function currentMonth() {
  return todayIso().slice(0, 7);
}

function isValidMonth(value) {
  const match = clean(value).match(/^(20\d{2})-(\d{2})$/);
  return !!match && Number(match[2]) >= 1 && Number(match[2]) <= 12;
}

function normalizeMonth(year, month) {
  const y = Number(clean(year));
  const m = Number(clean(month));
  if (!Number.isInteger(y) || y < 2000 || y > 2099 || !Number.isInteger(m) || m < 1 || m > 12) return '';
  return `${y}-${pad2(m)}`;
}

function toNumber(value) {
  const n = Number(clean(value));
  return Number.isFinite(n) && n >= 0 ? Number(n.toFixed(2)) : 0;
}

function formatHours(value) {
  const n = toNumber(value);
  return Number.isInteger(n) ? String(n) : String(n).replace(/0+$/, '').replace(/\.$/, '');
}

function formatSignedHours(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '0';
  const sign = n > 0 ? '+' : '-';
  return `${sign}${formatHours(Math.abs(n))}`;
}

function formatPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '0%';
  const rounded = Number(n.toFixed(1));
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : String(rounded)}%`;
}

function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function defaultTaskTypes() {
  return [];
}

function normalizeTaskTypes(taskTypes, fallback = []) {
  const result = [];
  const seen = new Set();
  const source = Array.isArray(taskTypes) ? taskTypes : fallback;
  source.forEach((item, index) => {
    const id = clean(item && item.id);
    if (!id || seen.has(id)) return;
    const legacy = CATEGORY_BY_ID.get(id) || {};
    const color = clean(item.color || legacy.color) || categoryColor(id, index);
    result.push(Object.assign({}, legacy, item, {
      id,
      label: clean(item.label || legacy.label || id),
      color,
      enabled: item.enabled !== false,
      requiresLogIssue: item.requiresLogIssue === true,
      sort: Number.isFinite(Number(item.sort)) ? Number(item.sort) : index
    }));
    seen.add(id);
  });
  return result.sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0) || a.label.localeCompare(b.label));
}

function normalizeTaskTemplates(templates, taskTypes = []) {
  const categoryIds = new Set(taskTypes.map((item) => item.id));
  const source = Array.isArray(templates) ? templates : [];
  return source.map((item, index) => {
    const category = clean(item.category);
    return {
      id: clean(item.id) || makeId('tpl'),
      name: clean(item.name),
      category: categoryIds.has(category) ? category : (taskTypes[0] && taskTypes[0].id) || 'feature',
      issue: clean(item.issue),
      plannedHours: toNumber(item.plannedHours ?? item.planned),
      status: clean(item.status || 'doing'),
      enabled: item.enabled !== false,
      sort: Number.isFinite(Number(item.sort)) ? Number(item.sort) : index
    };
  }).filter((item) => item.name).sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0) || a.name.localeCompare(b.name));
}

function normalizeSettings(settings) {
  const taskTypes = normalizeTaskTypes(settings.taskTypes);
  const defaultTaskTemplates = normalizeTaskTemplates(settings.defaultTaskTemplates, taskTypes);
  return {
    worklogFolder: clean(settings.worklogFolder) || DEFAULT_SETTINGS.worklogFolder,
    dataFolder: clean(settings.dataFolder) || DEFAULT_SETTINGS.dataFolder,
    createMonthlyNote: settings.createMonthlyNote === true,
    taskTypes,
    defaultTaskTemplates
  };
}

function categoryColor(id, index = 0) {
  const category = CATEGORY_BY_ID.get(id);
  return CATEGORY_COLORS[id] || (category && category.color) || FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

function categoryColorForData(category, index = 0) {
  return clean(category && category.color) || categoryColor(category && category.id, index);
}

function categorySortIndex(id) {
  return CATEGORY_ORDER_INDEX.has(id) ? CATEGORY_ORDER_INDEX.get(id) : CATEGORY_ORDER.length;
}

function categorySortValue(category) {
  if (category && Number.isFinite(Number(category.sort))) return Number(category.sort);
  return categorySortIndex(category && category.id ? category.id : category);
}

function compareCategories(a, b) {
  return categorySortValue(a) - categorySortValue(b) || clean(a && a.label).localeCompare(clean(b && b.label));
}

function chartScaleMax(value) {
  const raw = Math.max(1, toNumber(value));
  if (raw <= 8) return 8;
  const roughStep = raw / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const step = [1, 2, 2.5, 5, 10].map((item) => item * pow).find((item) => item >= roughStep) || 10 * pow;
  return Number((step * 4).toFixed(2));
}

function chartTicks(max) {
  return [4, 3, 2, 1, 0].map((index) => Number(((max / 4) * index).toFixed(2)));
}

function categoriesForData(data, configuredCategories) {
  const categories = [];
  const seen = new Set();
  const hasConfiguredCategories = Array.isArray(configuredCategories);
  const hasDataCategories = data && Array.isArray(data.categories);
  const effectiveCategories = Array.isArray(configuredCategories)
    ? configuredCategories
    : (data && Array.isArray(data.categories) ? data.categories : CATEGORIES);
  const taskCategoryIds = new Set((data && Array.isArray(data.tasks) ? data.tasks : []).map((task) => clean(task.category)).filter(Boolean));
  const add = (category) => {
    const id = clean(category && category.id);
    if (!id || seen.has(id)) return;
    const fallback = CATEGORY_BY_ID.get(id) || {};
    const index = categories.length;
    categories.push(Object.assign({}, fallback, category, {
      id,
      label: clean(category.label || fallback.label || id),
      color: clean(category.color || fallback.color) || categoryColor(id, index),
      enabled: category.enabled !== false,
      requiresLogIssue: category.requiresLogIssue === true,
      sort: Number.isFinite(Number(category.sort)) ? Number(category.sort) : index
    }));
    seen.add(id);
  };
  normalizeTaskTypes(effectiveCategories).forEach(add);
  (data && Array.isArray(data.categories) ? data.categories : [])
    .filter((category) => taskCategoryIds.has(clean(category && category.id)))
    .forEach(add);
  (data && Array.isArray(data.tasks) ? data.tasks : []).forEach((task) => add({ id: clean(task.category), label: clean(task.category) }));
  if (categories.length) return categories.sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0) || a.label.localeCompare(b.label));
  return hasConfiguredCategories || hasDataCategories ? [] : defaultTaskTypes();
}

function makeTaskId(date, sequence) {
  return `YZL${date.replace(/-/g, '')}${pad3(sequence)}`;
}

function taskIdDate(month, preferredDate) {
  const date = clean(preferredDate);
  if (/^20\d{2}-\d{2}-\d{2}$/.test(date) && (!month || date.startsWith(month))) return date;
  return `${month || currentMonth()}-01`;
}

function nextTaskId(tasks, month, preferredDate) {
  const ids = tasks instanceof Set ? tasks : new Set((tasks || []).map((task) => clean(task.id)).filter(Boolean));
  const date = taskIdDate(month, preferredDate);
  let sequence = 1;
  while (ids.has(makeTaskId(date, sequence))) sequence += 1;
  return makeTaskId(date, sequence);
}

function hasLogForTaskDate(logs, taskId, date, ignoreLogId = '') {
  return (logs || []).some((log) => clean(log.taskId) === clean(taskId) && clean(log.date) === clean(date) && (!ignoreLogId || clean(log.id) !== clean(ignoreLogId)));
}

function statusClass(status) {
  return `worklog-task-status-${(clean(status) || 'unknown').replace(/[^a-z0-9_-]/gi, '-').toLowerCase()}`;
}

function defaultData(month, settings = DEFAULT_SETTINGS) {
  const taskTypes = normalizeTaskTypes(settings.taskTypes);
  const enabledTypeIds = new Set(taskTypes.filter((item) => item.enabled !== false).map((item) => item.id));
  const templates = normalizeTaskTemplates(settings.defaultTaskTemplates, taskTypes)
    .filter((item) => item.enabled !== false && enabledTypeIds.has(item.category));
  const usedIds = new Set();
  const tasks = templates.map((task) => {
    const id = nextTaskId(usedIds, month, `${month}-01`);
    usedIds.add(id);
    return {
      id,
      name: task.name,
      category: task.category,
      issue: task.issue || '',
      plannedHours: toNumber(task.plannedHours),
      status: task.status || 'doing'
    };
  });
  const now = new Date().toISOString();
  return {
    schemaVersion: 2,
    month,
    categories: clone(taskTypes),
    tasks,
    logs: [],
    dailyStatus: { completedDates: [] },
    createdAt: now,
    updatedAt: now
  };
}

function normalizeData(raw, month, settings = DEFAULT_SETTINGS) {
  const data = Object.assign(defaultData(month, settings), raw || {});
  data.schemaVersion = 2;
  data.month = clean(data.month) || month;
  const taskTypes = normalizeTaskTypes(settings.taskTypes);
  data.categories = categoriesForData(data, taskTypes);
  delete data.statuses;
  data.tasks = (data.tasks || []).map((task) => ({
    id: clean(task.id),
    name: clean(task.name),
    category: clean(task.category || 'feature'),
    issue: clean(task.issue),
    plannedHours: toNumber(task.plannedHours ?? task.planned),
    status: clean(task.status || 'doing')
  }));
  const usedIds = new Set(data.tasks.map((task) => clean(task.id)).filter(Boolean));
  data.tasks = data.tasks.map((task) => {
    if (task.id) return task;
    const id = nextTaskId(usedIds, data.month, `${data.month}-01`);
    usedIds.add(id);
    return Object.assign({}, task, { id });
  });
  data.logs = (data.logs || []).map((log, index) => ({
    id: clean(log.id) || `log-${index}-${Date.now().toString(36)}`,
    date: clean(log.date),
    taskId: clean(log.taskId),
    hours: toNumber(log.hours),
    work: clean(log.work),
    issueLink: clean(log.issueLink || log.issue)
  }));
  const completed = data.dailyStatus && Array.isArray(data.dailyStatus.completedDates) ? data.dailyStatus.completedDates : [];
  data.dailyStatus = {
    completedDates: Array.from(new Set(completed.map(clean).filter((date) => /^20\d{2}-\d{2}-\d{2}$/.test(date) && date.startsWith(data.month)))).sort()
  };
  return data;
}

function buildCalendarCells(month, dailyHours, dailyCounts) {
  const match = clean(month).match(/^(20\d{2})-(\d{2})$/);
  if (!match) return [];
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  const firstWeekday = new Date(year, monthNumber - 1, 1).getDay();
  const offset = (firstWeekday + 6) % 7;
  const cells = [];
  for (let i = 0; i < offset; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${month}-${pad2(day)}`;
    cells.push({ date, day, hours: dailyHours.get(date) || 0, count: dailyCounts.get(date) || 0 });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function deriveWorklogData(data) {
  const tasksById = new Map();
  const actualByTask = new Map();
  const daily = new Map();
  const dailyCount = new Map();
  const categories = categoriesForData(data, data.categories);
  const taskCategoryIds = new Set(data.tasks.map((task) => clean(task.category)).filter(Boolean));
  const taskCategories = categories.filter((category) => taskCategoryIds.has(category.id));
  const categoryById = new Map(categories.map((item) => [item.id, item]));
  data.tasks.forEach((task) => tasksById.set(task.id, task));
  data.logs.forEach((log) => {
    const hours = toNumber(log.hours);
    actualByTask.set(log.taskId, (actualByTask.get(log.taskId) || 0) + hours);
    daily.set(log.date, (daily.get(log.date) || 0) + hours);
    dailyCount.set(log.date, (dailyCount.get(log.date) || 0) + 1);
  });
  const totalPlanned = data.tasks.reduce((sum, task) => sum + toNumber(task.plannedHours), 0);
  const totalActual = data.logs.reduce((sum, log) => sum + toNumber(log.hours), 0);
  return { tasksById, actualByTask, daily, dailyCount, categories, taskCategories, categoryById, totalPlanned, totalActual };
}

function taskTypeRowsForData(data, d = deriveWorklogData(data)) {
  const totalsByCategory = new Map(d.taskCategories.map((category) => [category.id, { planned: 0, actual: 0, tasks: 0 }]));
  data.tasks.forEach((task) => {
    const totals = totalsByCategory.get(task.category);
    if (!totals) return;
    totals.planned += toNumber(task.plannedHours);
    totals.tasks += 1;
  });
  data.logs.forEach((log) => {
    const task = d.tasksById.get(log.taskId);
    const totals = task ? totalsByCategory.get(task.category) : null;
    if (totals) totals.actual += toNumber(log.hours);
  });
  return d.taskCategories.map((category) => {
    const totals = totalsByCategory.get(category.id) || { planned: 0, actual: 0, tasks: 0 };
    return {
      id: category.id,
      label: category.label,
      color: categoryColorForData(category),
      sort: category.sort,
      planned: totals.planned,
      actual: totals.actual,
      tasks: totals.tasks,
      plannedRatio: d.totalPlanned > 0 ? (totals.planned / d.totalPlanned) * 100 : 0,
      actualRatio: d.totalActual > 0 ? (totals.actual / d.totalActual) * 100 : 0,
      taskRatio: data.tasks.length > 0 ? (totals.tasks / data.tasks.length) * 100 : 0
    };
  }).sort((a, b) => compareCategories(a, b) || b.actual - a.actual || a.label.localeCompare(b.label));
}

function yearSummary(items) {
  const byYear = new Map();
  items.forEach((data) => {
    const year = data.month.slice(0, 4);
    if (!byYear.has(year)) {
      byYear.set(year, {
        year,
        months: [],
        totalPlanned: 0,
        totalActual: 0,
        totalLogs: 0,
        totalTasks: 0,
        taskIds: new Set(),
        categories: new Map()
      });
    }
    const summary = byYear.get(year);
    const d = deriveWorklogData(data);
    data.tasks.forEach((task) => {
      summary.taskIds.add(task.id);
      const categoryId = clean(task.category) || 'blank';
      const category = d.categoryById.get(categoryId);
      const label = category ? category.label : categoryId === 'blank' ? '（空白）' : categoryId;
      if (!summary.categories.has(categoryId)) {
        summary.categories.set(categoryId, { id: categoryId, label, color: categoryColorForData(category), sort: category ? category.sort : categorySortIndex(categoryId), planned: 0, actual: 0, tasks: 0 });
      }
      const row = summary.categories.get(categoryId);
      row.planned += toNumber(task.plannedHours);
      row.tasks += 1;
    });
    data.logs.forEach((log) => {
      const task = d.tasksById.get(log.taskId);
      const categoryId = task ? task.category : 'unknown';
      const category = d.categoryById.get(categoryId);
      const label = category ? category.label : categoryId === 'unknown' ? '未找到任务' : categoryId;
      const hours = toNumber(log.hours);
      if (!summary.categories.has(categoryId)) {
        summary.categories.set(categoryId, { id: categoryId, label, color: categoryColorForData(category), sort: category ? category.sort : categorySortIndex(categoryId), planned: 0, actual: 0, tasks: 0 });
      }
      summary.categories.get(categoryId).actual += hours;
    });
    summary.totalPlanned += d.totalPlanned;
    summary.totalActual += d.totalActual;
    summary.totalLogs += data.logs.length;
    summary.totalTasks += data.tasks.length;
    summary.months.push({
      month: data.month,
      plannedHours: d.totalPlanned,
      actualHours: d.totalActual,
      logs: data.logs.length,
      tasks: data.tasks.length
    });
  });
  return Array.from(byYear.values()).sort((a, b) => b.year.localeCompare(a.year)).map((summary) => {
    summary.months.sort((a, b) => a.month.localeCompare(b.month));
    summary.categoryRows = Array.from(summary.categories.values())
      .sort((a, b) => compareCategories(a, b) || b.actual - a.actual || a.label.localeCompare(b.label))
      .map((category) => Object.assign({}, category, {
        color: clean(category.color) || categoryColor(category.id),
        plannedRatio: summary.totalPlanned > 0 ? (category.planned / summary.totalPlanned) * 100 : 0,
        actualRatio: summary.totalActual > 0 ? (category.actual / summary.totalActual) * 100 : 0,
        taskRatio: summary.totalTasks > 0 ? (category.tasks / summary.totalTasks) * 100 : 0
      }));
    return summary;
  });
}

function statusLabel(status) {
  const item = STATUSES.find((candidate) => candidate.id === clean(status));
  return item ? item.label : clean(status) || '-';
}

function markdownCell(value, fallback = '-') {
  const text = clean(value);
  if (!text) return fallback;
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function markdownTable(headers, rows, emptyText = '暂无数据。') {
  if (!rows.length) return `${emptyText}\n`;
  const headerLine = `| ${headers.map((header) => markdownCell(header)).join(' | ')} |`;
  const separator = `| ${headers.map(() => '---').join(' | ')} |`;
  const rowLines = rows.map((row) => `| ${row.map((cell) => markdownCell(cell)).join(' | ')} |`);
  return `${[headerLine, separator].concat(rowLines).join('\n')}\n`;
}

function buildMonthNoteContent(data, dataPath) {
  const d = deriveWorklogData(data);
  const diff = d.totalActual - d.totalPlanned;
  const statsRows = [
    ['计划工时', `${formatHours(d.totalPlanned)}h`],
    ['实际工时', `${formatHours(d.totalActual)}h`],
    ['差异', `${formatSignedHours(diff)}h`],
    ['任务数', String(data.tasks.length)],
    ['记录数', String(data.logs.length)]
  ];
  const categoryRows = taskTypeRowsForData(data, d).map((category) => [
    category.label,
    `${formatHours(category.planned)}h`,
    `${formatHours(category.actual)}h`,
    `${formatSignedHours(category.actual - category.planned)}h`
  ]);
  const completed = new Set(data.dailyStatus.completedDates || []);
  const calendarCells = buildCalendarCells(data.month, d.daily, d.dailyCount);
  const calendarRows = [];
  for (let i = 0; i < calendarCells.length; i += 7) {
    calendarRows.push(calendarCells.slice(i, i + 7).map((cell) => {
      if (!cell) return '';
      const lines = [String(cell.day)];
      if (cell.count) lines.push(`${formatHours(cell.hours)}h`, `${cell.count}条记录`);
      lines.push(completed.has(cell.date) ? '已完成' : '未完成');
      return lines.join('<br>');
    }));
  }
  const taskRows = data.tasks.map((task) => {
    const category = d.categoryById.get(task.category);
    return [
      task.id,
      task.name,
      category ? category.label : task.category,
      task.issue || '-',
      `${formatHours(task.plannedHours)}h`,
      `${formatHours(d.actualByTask.get(task.id) || 0)}h`,
      statusLabel(task.status)
    ];
  });
  const logRows = data.logs.map((log) => {
    const task = d.tasksById.get(log.taskId);
    return [
      log.date,
      log.taskId,
      task ? task.name : '未找到任务',
      `${formatHours(log.hours)}h`,
      log.work,
      log.issueLink || (task ? task.issue : '') || '-'
    ];
  });
  const updatedAt = clean(data.updatedAt || new Date().toISOString());
  return `---\ntype: worklog-month\nmonth: ${data.month}\nsystem: Worklog Plugin\ndata: ${dataPath}\nupdated: ${updatedAt}\n---\n\n# ${data.month} 工时工作台\n\n> 本笔记由 Worklog 插件根据本地 JSON 自动生成，工时工作台中的看板、日历、任务和明细会同步到这里。\n\n## 月度数据看板\n\n${markdownTable(['指标', '数值'], statsRows)}\n## 分类工时\n\n${markdownTable(['类型', '计划工时', '实际工时', '差异'], categoryRows, '暂无任务数据。')}\n## 日历\n\n${markdownTable(['一', '二', '三', '四', '五', '六', '日'], calendarRows, '暂无日历数据。')}\n## 任务清单\n\n${markdownTable(['任务 ID', '任务', '类型', 'issue', '计划', '实际', '状态'], taskRows, '暂无任务数据。')}\n## 每日工时明细\n\n${markdownTable(['日期', '任务 ID', '任务', '工时', '做了什么', 'issue'], logRows, '暂无工时记录。')}\n`;
}

class WorklogPlugin extends Plugin {
  async onload() {
    this.settings = await this.loadSettings();
    await this.saveSettings();
    this.registerView(VIEW_TYPE, (leaf) => new WorklogView(leaf, this));
    this.registerView(YEAR_VIEW_TYPE, (leaf) => new YearDashboardView(leaf, this));
    this.registerEvent(this.app.vault.on('modify', (file) => this.handleDataFileModify(file)));
    this.addRibbonIcon('calendar-clock', '打开工时工作台', () => this.openView(currentMonth()));
    this.addCommand({ id: 'open-worklog', name: '打开工时工作台', callback: () => this.openView(currentMonth()) });
    this.addCommand({ id: 'open-worklog-month', name: '选择年月打开工时工作台', callback: () => new MonthPickerModal(this.app, this, currentMonth()).open() });
    this.addCommand({ id: 'open-worklog-year-dashboard', name: '打开年度工时看板', callback: () => this.openYearDashboard() });
    this.addSettingTab(new WorklogSettingTab(this.app, this));
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(YEAR_VIEW_TYPE);
  }

  configPath() {
    return `${this.manifest.dir}/${CONFIG_FILE_NAME}`;
  }

  async loadSettings() {
    const path = this.configPath();
    let settings = {};
    try {
      if (await this.app.vault.adapter.exists(path)) {
        settings = JSON.parse(await this.app.vault.adapter.read(path));
      }
    } catch (error) {
      console.error('Worklog: failed to load settings config', error);
    }
    return normalizeSettings(Object.assign({}, DEFAULT_SETTINGS, settings));
  }

  async saveSettings() {
    this.settings = normalizeSettings(this.settings);
    await this.app.vault.adapter.write(this.configPath(), JSON.stringify(this.settings, null, 2));
  }

  dataPath(month) {
    return `${this.settings.dataFolder}/${month}.json`;
  }

  monthFromDataPath(path) {
    const prefix = `${this.settings.dataFolder}/`;
    if (!path.startsWith(prefix) || !path.endsWith('.json')) return '';
    return path.slice(prefix.length, -5);
  }

  async handleDataFileModify(file) {
    const month = this.monthFromDataPath(file.path || '');
    if (!month) return;
    this.refreshMonthViews(month);
    this.refreshYearDashboards();
  }

  refreshMonthViews(month) {
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => {
      const view = leaf.view;
      if (view && view.month === month && typeof view.load === 'function') view.load();
    });
  }

  refreshYearDashboards() {
    this.app.workspace.getLeavesOfType(YEAR_VIEW_TYPE).forEach((leaf) => {
      const view = leaf.view;
      if (view && typeof view.load === 'function') view.load();
    });
  }

  refreshOpenViews() {
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => {
      const view = leaf.view;
      if (view && typeof view.load === 'function') view.load();
    });
    this.refreshYearDashboards();
  }

  notePath(month) {
    return `${this.settings.worklogFolder}/${month}.md`;
  }

  async ensureFolder(folder) {
    const parts = clean(folder).split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) await this.app.vault.createFolder(current);
    }
  }

  async ensureAdapterFolder(folder) {
    const parts = clean(folder).split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!(await this.app.vault.adapter.exists(current))) await this.app.vault.adapter.mkdir(current);
    }
  }

  async readData(month) {
    await this.ensureAdapterFolder(this.settings.dataFolder);
    const path = this.dataPath(month);
    if (!(await this.app.vault.adapter.exists(path))) {
      const data = defaultData(month, this.settings);
      await this.app.vault.adapter.write(path, JSON.stringify(data, null, 2));
      return data;
    }
    try {
      return normalizeData(JSON.parse(await this.app.vault.adapter.read(path)), month, this.settings);
    } catch (error) {
      console.error(`Worklog: failed to read ${path}`, error);
      new Notice(`工时数据读取失败，请检查 ${path}`);
      return normalizeData({}, month, this.settings);
    }
  }

  async dataFiles() {
    const prefix = `${this.settings.dataFolder}/`;
    if (!(await this.app.vault.adapter.exists(this.settings.dataFolder))) return [];
    const listed = await this.app.vault.adapter.list(this.settings.dataFolder);
    return listed.files
      .filter((path) => path.startsWith(prefix) && path.endsWith('.json') && isValidMonth(path.slice(prefix.length, -5)))
      .sort((a, b) => a.localeCompare(b));
  }

  async readExistingData(path) {
    const month = this.monthFromDataPath(path || '');
    if (!isValidMonth(month)) return null;
    try {
      return normalizeData(JSON.parse(await this.app.vault.adapter.read(path)), month, this.settings);
    } catch (error) {
      console.error(`Worklog: failed to read ${path}`, error);
      return null;
    }
  }

  async readAllExistingData() {
    const files = await this.dataFiles();
    const items = await Promise.all(files.map((file) => this.readExistingData(file)));
    return items.filter(Boolean);
  }

  async writeData(data) {
    await this.ensureAdapterFolder(this.settings.dataFolder);
    const month = data.month || currentMonth();
    const path = this.dataPath(month);
    const next = Object.assign({}, data, { updatedAt: new Date().toISOString() });
    await this.app.vault.adapter.write(path, JSON.stringify(next, null, 2));
    await this.maybeSyncMonthNote(next);
    this.refreshMonthViews(month);
    this.refreshYearDashboards();
    return next;
  }

  shouldSyncMonthNote() {
    return !!this.settings.createMonthlyNote;
  }

  async maybeSyncMonthNote(data) {
    if (!this.shouldSyncMonthNote()) return null;
    return this.syncMonthNote(data);
  }

  async syncMonthNote(data) {
    const month = data.month || currentMonth();
    await this.ensureFolder(this.settings.worklogFolder);
    const path = this.notePath(month);
    const content = buildMonthNoteContent(data, this.dataPath(month));
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file) {
      const current = await this.app.vault.read(file);
      if (current !== content) await this.app.vault.modify(file, content);
      return file;
    }
    return this.app.vault.create(path, content);
  }

  async openView(month = currentMonth()) {
    if (!isValidMonth(month)) {
      new Notice(`无效月份：${month}`);
      return;
    }
    const data = await this.readData(month);
    await this.maybeSyncMonthNote(data);
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.setViewState({ type: VIEW_TYPE, active: true, state: { month } });
    this.app.workspace.revealLeaf(leaf);
  }

  async openYearDashboard() {
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.setViewState({ type: YEAR_VIEW_TYPE, active: true, state: {} });
    this.app.workspace.revealLeaf(leaf);
  }
}

class MonthPickerModal extends Modal {
  constructor(app, plugin, initialMonth) {
    super(app);
    this.plugin = plugin;
    this.initialMonth = isValidMonth(initialMonth) ? initialMonth : currentMonth();
  }

  onOpen() {
    this.setTitle('选择工时月份');
    const [initialYear, initialMonthNumber] = this.initialMonth.split('-');
    const year = this.addInput('年份', initialYear, 'number');
    const month = this.addInput('月份', String(Number(initialMonthNumber)), 'number');
    new Setting(this.contentEl).addButton((button) => button.setButtonText('打开工时工作台').setCta().onClick(async () => {
      const selectedMonth = normalizeMonth(year.value, month.value);
      if (!selectedMonth) return new Notice('请输入有效年月，例如 2026 年 5 月');
      await this.plugin.openView(selectedMonth);
      this.close();
    }));
  }

  addInput(label, value = '', type = 'text') {
    let input;
    new Setting(this.contentEl).setName(label).addText((text) => {
      input = text.inputEl;
      input.type = type;
      input.value = value;
    });
    return input;
  }
}

class WorklogView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.month = currentMonth();
    this.selectedDate = '';
    this.data = null;
  }

  getViewType() {
    return VIEW_TYPE;
  }

  getDisplayText() {
    return '工时工作台';
  }

  getIcon() {
    return 'calendar-clock';
  }

  async setState(state, result) {
    await super.setState(state, result);
    this.month = state && state.month ? state.month : currentMonth();
    await this.load();
  }

  getState() {
    return Object.assign({}, super.getState(), { month: this.month });
  }

  async onOpen() {
    await this.load();
  }

  async load() {
    this.data = await this.plugin.readData(this.month);
    await this.plugin.maybeSyncMonthNote(this.data);
    this.render();
  }

  async save(next) {
    this.data = await this.plugin.writeData(next);
    this.render();
  }

  derived() {
    return deriveWorklogData(this.data);
  }

  el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  button(text, className, onClick) {
    const button = this.el('button', `worklog-button ${className || ''}`.trim(), text);
    button.addEventListener('click', onClick);
    return button;
  }

  render() {
    this.contentEl.empty();
    const root = this.contentEl.createDiv({ cls: 'worklog-plugin-view' });
    if (!this.data) {
      root.createEl('div', { text: '加载中...' });
      return;
    }
    const d = this.derived();
    const header = this.el('div', 'worklog-header');
    header.appendChild(this.el('h2', '', `${this.data.month} 工时工作台`));
    const actions = this.el('div', 'worklog-actions');
    actions.appendChild(this.button('新增任务', '', () => new TaskModal(this.app, this, this.selectedDate).open()));
    actions.appendChild(this.button('新增工时', 'primary', () => new LogModal(this.app, this, this.selectedDate).open()));
    header.appendChild(actions);
    root.appendChild(header);

    root.appendChild(this.renderDashboard(d));
    root.appendChild(this.renderCalendar(d));
    root.appendChild(this.renderTasks(d));
    root.appendChild(this.renderLogs(d));
  }

  renderDashboard(d) {
    const section = this.el('section', 'worklog-dashboard');
    const head = this.el('div', 'worklog-section-head');
    head.appendChild(this.el('h3', '', '月度数据看板'));
    const hint = this.el('div', 'worklog-hint', '实时读取本地 JSON');
    head.appendChild(hint);
    section.appendChild(head);

    const diff = d.totalActual - d.totalPlanned;
    const stats = this.el('div', 'worklog-stats');
    stats.appendChild(this.stat('计划工时', formatHours(d.totalPlanned)));
    stats.appendChild(this.stat('实际工时', formatHours(d.totalActual)));
    stats.appendChild(this.stat('差异', formatSignedHours(diff), diff > 0 ? 'warn' : diff < 0 ? 'good' : ''));
    stats.appendChild(this.stat('任务数', String(this.data.tasks.length)));
    stats.appendChild(this.stat('记录数', String(this.data.logs.length)));
    section.appendChild(stats);
    section.appendChild(this.renderChart(d));
    return section;
  }

  stat(label, value, tone = '') {
    const item = this.el('div', `worklog-stat ${tone ? `worklog-stat-${tone}` : ''}`.trim());
    item.appendChild(this.el('span', 'label', label));
    item.appendChild(this.el('strong', '', value));
    return item;
  }

  renderChart(d) {
    const rows = taskTypeRowsForData(this.data, d).map((category) => ({ category, planned: category.planned, actual: category.actual }));
    const panel = this.el('div', 'worklog-chart-panel');
    const legend = this.el('div', 'worklog-chart-legend');
    legend.appendChild(this.legendItem('计划工时', 'planned'));
    legend.appendChild(this.legendItem('实际工时', 'actual'));
    panel.appendChild(legend);
    if (!rows.length) {
      panel.appendChild(this.el('div', 'worklog-empty', '暂无任务数据'));
      return panel;
    }
    const max = chartScaleMax(Math.max(1, ...rows.map((row) => Math.max(row.planned, row.actual))));
    const ticks = chartTicks(max);
    const chart = this.el('div', 'worklog-chart');
    const yAxis = this.el('div', 'worklog-chart-y-axis');
    yAxis.appendChild(this.el('div', 'worklog-chart-axis-title', '工时'));
    const tickList = this.el('div', 'worklog-chart-ticks');
    ticks.forEach((tick) => tickList.appendChild(this.el('span', '', formatHours(tick))));
    yAxis.appendChild(tickList);
    chart.appendChild(yAxis);
    const body = this.el('div', 'worklog-chart-body');
    const grid = this.el('div', 'worklog-chart-grid');
    ticks.forEach(() => grid.appendChild(this.el('span', 'worklog-chart-grid-line')));
    body.appendChild(grid);
    const groups = this.el('div', 'worklog-chart-groups');
    const tooltip = this.el('div', 'worklog-chart-tooltip');
    rows.forEach((row) => {
      const group = this.el('div', 'worklog-chart-group');
      const bars = this.el('div', 'worklog-chart-bars');
      bars.appendChild(this.bar(row.planned, max, 'planned'));
      bars.appendChild(this.bar(row.actual, max, 'actual'));
      bars.appendChild(this.barFocusArea(row, max, body, tooltip));
      group.appendChild(bars);
      group.appendChild(this.el('div', 'worklog-chart-label', row.category.label));
      groups.appendChild(group);
    });
    body.appendChild(groups);
    body.appendChild(tooltip);
    chart.appendChild(body);
    panel.appendChild(chart);
    return panel;
  }

  legendItem(text, tone) {
    const item = this.el('span', 'worklog-chart-legend-item');
    item.appendChild(this.el('span', `worklog-chart-swatch ${tone}`));
    item.appendChild(document.createTextNode(text));
    return item;
  }

  showChartTooltip(event, chartBody, tooltip, row) {
    this.renderChartTooltip(tooltip, row);
    this.positionChartTooltip(event, chartBody, tooltip);
    tooltip.classList.add('is-visible');
  }

  hideChartTooltip(tooltip) {
    tooltip.classList.remove('is-visible');
  }

  renderChartTooltip(tooltip, row) {
    tooltip.textContent = '';
    tooltip.appendChild(this.el('strong', 'worklog-chart-tooltip-title', row.category.label));
    tooltip.appendChild(this.tooltipRow('计划工时', 'planned', row.planned));
    tooltip.appendChild(this.tooltipRow('实际工时', 'actual', row.actual));
    tooltip.appendChild(this.tooltipRow('计划占比', 'planned', formatPercent(row.category.plannedRatio)));
  }

  positionChartTooltip(event, chartBody, tooltip) {
    const bodyRect = chartBody.getBoundingClientRect();
    const tipWidth = tooltip.offsetWidth || 142;
    const tipHeight = tooltip.offsetHeight || 92;
    const maxLeft = Math.max(8, chartBody.clientWidth - tipWidth - 8);
    const maxTop = Math.max(8, chartBody.clientHeight - tipHeight - 8);
    const left = Math.min(Math.max(event.clientX - bodyRect.left + 14, 8), maxLeft);
    const top = Math.min(Math.max(event.clientY - bodyRect.top + 14, 8), maxTop);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  centerChartTooltip(chartBody, target, tooltip, row) {
    this.renderChartTooltip(tooltip, row);
    const bodyRect = chartBody.getBoundingClientRect();
    const groupRect = target.getBoundingClientRect();
    const tipWidth = tooltip.offsetWidth || 142;
    const tipHeight = tooltip.offsetHeight || 92;
    const left = Math.min(Math.max(groupRect.left - bodyRect.left + groupRect.width / 2 + 12, 8), Math.max(8, chartBody.clientWidth - tipWidth - 8));
    const top = Math.min(Math.max(groupRect.top - bodyRect.top + groupRect.height / 2 - tipHeight / 2, 8), Math.max(8, chartBody.clientHeight - tipHeight - 8));
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    tooltip.classList.add('is-visible');
  }

  tooltipRow(text, tone, value) {
    const row = this.el('div', 'worklog-chart-tooltip-row');
    row.appendChild(this.el('span', `worklog-chart-dot ${tone}`));
    row.appendChild(this.el('span', '', text));
    row.appendChild(this.el('b', '', typeof value === 'number' ? `${formatHours(value)}h` : value));
    return row;
  }

  barFocusArea(row, max, chartBody, tooltip) {
    const planned = toNumber(row.planned);
    const actual = toNumber(row.actual);
    const maxHours = Math.max(planned, actual);
    const area = this.el('div', 'worklog-chart-focus-area');
    if (maxHours <= 0) {
      area.setAttribute('aria-hidden', 'true');
      return area;
    }
    const hasPlanned = planned > 0;
    const hasActual = actual > 0;
    if (hasPlanned && hasActual) area.addClass('is-pair');
    else if (hasPlanned) area.addClass('is-planned-only');
    else if (hasActual) area.addClass('is-actual-only');
    area.style.height = `${Math.round((maxHours / max) * 100)}%`;
    area.tabIndex = 0;
    area.addEventListener('mousemove', (event) => this.showChartTooltip(event, chartBody, tooltip, row));
    area.addEventListener('mouseenter', (event) => this.showChartTooltip(event, chartBody, tooltip, row));
    area.addEventListener('mouseleave', () => this.hideChartTooltip(tooltip));
    area.addEventListener('focus', () => this.centerChartTooltip(chartBody, area, tooltip, row));
    area.addEventListener('blur', () => this.hideChartTooltip(tooltip));
    return area;
  }

  bar(value, max, tone) {
    const bar = this.el('div', `worklog-chart-bar ${tone}`);
    const hours = toNumber(value);
    bar.style.height = hours > 0 ? `${Math.round((hours / max) * 100)}%` : '0';
    bar.setAttribute('aria-hidden', 'true');
    return bar;
  }

  renderCalendar(d) {
    const section = this.el('section', 'worklog-section');
    section.appendChild(this.el('h3', '', '日历'));
    const grid = this.el('div', 'worklog-calendar');
    ['一', '二', '三', '四', '五', '六', '日'].forEach((label) => grid.appendChild(this.el('div', 'weekday', label)));
    const completed = new Set(this.data.dailyStatus.completedDates || []);
    buildCalendarCells(this.data.month, d.daily, d.dailyCount).forEach((cell, index) => {
      if (!cell) {
        grid.appendChild(this.el('div', 'empty'));
        return;
      }
      const day = this.el('button', 'day', '');
      if (this.selectedDate === cell.date) day.addClass('selected');
      if (completed.has(cell.date)) day.addClass('done');
      day.appendChild(this.el('span', 'day-number', String(cell.day)));
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = completed.has(cell.date);
      checkbox.addEventListener('click', (event) => event.stopPropagation());
      checkbox.addEventListener('change', async () => {
        const dates = new Set(this.data.dailyStatus.completedDates || []);
        if (checkbox.checked) dates.add(cell.date);
        else dates.delete(cell.date);
        await this.save(Object.assign({}, this.data, { dailyStatus: { completedDates: Array.from(dates).sort() } }));
      });
      day.appendChild(checkbox);
      if (cell.count) day.appendChild(this.el('span', 'day-hours', `${formatHours(cell.hours)}h`));
      day.addEventListener('click', () => {
        this.selectedDate = this.selectedDate === cell.date ? '' : cell.date;
        this.render();
      });
      grid.appendChild(day);
    });
    section.appendChild(grid);
    return section;
  }

  renderTasks(d) {
    const section = this.el('section', 'worklog-section');
    section.appendChild(this.el('h3', '', '任务清单'));
    const table = this.el('table', 'worklog-table');
    table.innerHTML = '<thead><tr><th>任务 ID</th><th>任务</th><th>类型</th><th>issue</th><th>计划</th><th>实际</th><th>状态</th><th>操作</th></tr></thead>';
    const body = this.el('tbody');
    this.data.tasks.forEach((task, index) => {
      const tr = this.el('tr', `worklog-task-row ${statusClass(task.status)}`);
      const category = d.categoryById.get(task.category);
      tr.appendChild(this.td(task.id, 'worklog-key-text'));
      tr.appendChild(this.td(task.name, 'worklog-key-text'));
      tr.appendChild(this.td(category ? category.label : task.category, 'worklog-key-text'));
      tr.appendChild(this.td(task.issue || '-', 'worklog-key-text'));
      tr.appendChild(this.td(`${formatHours(task.plannedHours)}h`, 'worklog-key-text'));
      tr.appendChild(this.td(`${formatHours(d.actualByTask.get(task.id) || 0)}h`, 'worklog-key-text'));
      const statusTd = this.el('td');
      const select = document.createElement('select');
      STATUSES.forEach((status) => select.appendChild(new Option(status.label, status.id)));
      select.value = task.status;
      select.addEventListener('change', async () => {
        const tasks = this.data.tasks.slice();
        tasks[index] = Object.assign({}, task, { status: select.value });
        await this.save(Object.assign({}, this.data, { tasks }));
      });
      statusTd.appendChild(select);
      tr.appendChild(statusTd);
      const actionTd = this.el('td');
      actionTd.appendChild(this.button('删除', 'ghost', async () => {
        const refs = this.data.logs.filter((log) => log.taskId === task.id).length;
        if (refs > 0 && !confirm(`这个任务已有 ${refs} 条工时记录，删除任务会同时删除这些记录。继续？`)) return;
        await this.save(Object.assign({}, this.data, {
          tasks: this.data.tasks.filter((_, i) => i !== index),
          logs: this.data.logs.filter((log) => log.taskId !== task.id)
        }));
      }));
      tr.appendChild(actionTd);
      body.appendChild(tr);
    });
    table.appendChild(body);
    section.appendChild(table);
    return section;
  }

  renderLogs(d) {
    const section = this.el('section', 'worklog-section');
    const title = this.selectedDate ? `每日工时明细：${this.selectedDate}` : '每日工时明细';
    section.appendChild(this.el('h3', '', title));
    const table = this.el('table', 'worklog-table');
    table.innerHTML = '<thead><tr><th>日期</th><th>任务 ID</th><th>任务</th><th>工时</th><th>做了什么</th><th>issue</th><th>操作</th></tr></thead>';
    const body = this.el('tbody');
    const rows = this.selectedDate ? this.data.logs.filter((log) => log.date === this.selectedDate) : this.data.logs;
    rows.forEach((log) => {
      const index = this.data.logs.findIndex((item) => item.id === log.id);
      const task = d.tasksById.get(log.taskId);
      const tr = this.el('tr');
      tr.appendChild(this.td(log.date));
      tr.appendChild(this.td(log.taskId));
      tr.appendChild(this.td(task ? task.name : '未找到任务'));
      tr.appendChild(this.td(`${formatHours(log.hours)}h`));
      tr.appendChild(this.td(log.work));
      tr.appendChild(this.td(log.issueLink || (task ? task.issue : '') || '-'));
      const actionTd = this.el('td');
      actionTd.appendChild(this.button('删除', 'ghost', async () => {
        if (!confirm('删除这条工时记录？')) return;
        await this.save(Object.assign({}, this.data, { logs: this.data.logs.filter((_, i) => i !== index) }));
      }));
      tr.appendChild(actionTd);
      body.appendChild(tr);
    });
    table.appendChild(body);
    section.appendChild(table);
    return section;
  }

  td(text, className = '') {
    return this.el('td', className, text);
  }
}

class YearDashboardView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.data = [];
  }

  getViewType() {
    return YEAR_VIEW_TYPE;
  }

  getDisplayText() {
    return '年度工时看板';
  }

  getIcon() {
    return 'bar-chart-3';
  }

  async onOpen() {
    await this.load();
  }

  async load() {
    this.data = await this.plugin.readAllExistingData();
    this.render();
  }

  el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  button(text, className, onClick) {
    const button = this.el('button', `worklog-button ${className || ''}`.trim(), text);
    button.addEventListener('click', onClick);
    return button;
  }

  render() {
    this.contentEl.empty();
    const root = this.contentEl.createDiv({ cls: 'worklog-plugin-view worklog-year-view' });
    const summaries = yearSummary(this.data);

    const header = this.el('div', 'worklog-header');
    header.appendChild(this.el('h2', '', '年度工时看板'));
    const actions = this.el('div', 'worklog-actions');
    actions.appendChild(this.button('刷新', '', () => this.load()));
    header.appendChild(actions);
    root.appendChild(header);

    if (!summaries.length) {
      root.appendChild(this.el('div', 'worklog-empty', '暂无年度数据'));
      return;
    }

    summaries.forEach((summary) => root.appendChild(this.renderYear(summary)));
  }

  renderYear(summary) {
    const section = this.el('section', 'worklog-year-section');
    const header = this.el('div', 'worklog-section-head');
    header.appendChild(this.el('h3', '', `${summary.year} 年`));
    header.appendChild(this.el('div', 'worklog-hint', `汇总 ${summary.months.length} 个月 · ${summary.totalLogs} 条记录`));
    section.appendChild(header);
    section.appendChild(this.renderSummaryStats(summary));
    const body = this.el('div', 'worklog-year-body');
    body.appendChild(this.renderTaskTypePie(summary));
    body.appendChild(this.renderMonthlyLineChart(summary));
    section.appendChild(body);
    return section;
  }

  renderSummaryStats(summary) {
    const panel = this.el('div', 'worklog-year-panel');
    panel.appendChild(this.el('div', 'worklog-year-panel-title', '总数据统计'));
    const diff = summary.totalActual - summary.totalPlanned;
    const stats = this.el('div', 'worklog-year-stats');
    stats.appendChild(this.summaryStat('月份', String(summary.months.length)));
    stats.appendChild(this.summaryStat('计划工时', `${formatHours(summary.totalPlanned)}h`));
    stats.appendChild(this.summaryStat('实际工时', `${formatHours(summary.totalActual)}h`));
    stats.appendChild(this.summaryStat('差异', `${formatSignedHours(diff)}h`, diff > 0 ? 'warn' : diff < 0 ? 'good' : ''));
    stats.appendChild(this.summaryStat('任务数量', String(summary.totalTasks)));
    panel.appendChild(stats);
    return panel;
  }

  renderTaskTypePie(summary) {
    const panel = this.el('div', 'worklog-year-panel worklog-pie-panel');
    panel.appendChild(this.el('div', 'worklog-year-panel-title', '全年任务类型统计'));
    if (!summary.categoryRows.length || summary.totalTasks <= 0) {
      panel.appendChild(this.el('div', 'worklog-empty worklog-empty-compact', '暂无任务类型数据'));
      return panel;
    }

    const size = 240;
    const outerRadius = 84;
    const innerRadius = 48;
    const center = size / 2;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'worklog-pie-chart');
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `${summary.year} 全年任务类型占比圆环图`);

    const visual = this.el('div', 'worklog-pie-visual');
    const tooltip = this.el('div', 'worklog-year-tooltip worklog-pie-tooltip');
    const activeRows = summary.categoryRows.filter((category) => category.tasks > 0);
    let angle = -90;
    activeRows.forEach((category, rowIndex) => {
      const index = summary.categoryRows.indexOf(category);
      const color = categoryColorForData(category, index);
      const ratio = category.tasks / summary.totalTasks;
      const startAngle = angle;
      const endAngle = rowIndex === activeRows.length - 1 ? 270 : startAngle + ratio * 360;
      const normalPath = this.donutSlicePath(center, center, outerRadius, innerRadius, startAngle, endAngle);
      const activePath = this.donutSlicePath(center, center, outerRadius + 6, innerRadius, startAngle, endAngle);
      const slice = this.svgEl('path', {
        class: 'worklog-pie-slice',
        d: normalPath
      });
      const setActive = (active) => {
        slice.setAttribute('d', active ? activePath : normalPath);
        slice.classList.toggle('is-active', active);
      };
      slice.style.fill = color;
      slice.style.setProperty('--worklog-pie-focus', color);
      slice.setAttribute('tabindex', '0');
      slice.setAttribute('aria-label', `${category.label}：${category.tasks} 个任务，${formatPercent(category.taskRatio)}`);
      slice.addEventListener('mousemove', (event) => this.showPieTooltip(event, visual, tooltip, category, color));
      slice.addEventListener('mouseenter', (event) => {
        setActive(true);
        this.showPieTooltip(event, visual, tooltip, category, color);
      });
      slice.addEventListener('mouseleave', () => {
        setActive(false);
        this.hidePieTooltip(tooltip);
      });
      slice.addEventListener('focus', () => {
        setActive(true);
        this.centerPieTooltip(visual, slice, tooltip, category, color);
      });
      slice.addEventListener('blur', () => {
        setActive(false);
        this.hidePieTooltip(tooltip);
      });
      svg.appendChild(slice);
      angle = endAngle;
    });

    visual.appendChild(svg);
    visual.appendChild(tooltip);

    const legendRows = activeRows.map((category) => ({ category, color: categoryColorForData(category, summary.categoryRows.indexOf(category)) }));
    const legendWrap = this.el('div', 'worklog-pie-legend-wrap');
    const prev = this.el('button', 'worklog-pie-legend-arrow', '◀');
    const next = this.el('button', 'worklog-pie-legend-arrow', '▶');
    prev.type = 'button';
    next.type = 'button';
    const legend = this.el('div', 'worklog-pie-legend');
    const pageText = this.el('span', 'worklog-pie-legend-page');
    const pageSize = 2;
    let page = 0;
    const renderLegendPage = () => {
      const pageCount = Math.max(1, Math.ceil(legendRows.length / pageSize));
      page = Math.max(0, Math.min(page, pageCount - 1));
      legend.textContent = '';
      legendRows.slice(page * pageSize, page * pageSize + pageSize).forEach(({ category, color }) => {
        const item = this.el('div', 'worklog-pie-legend-item');
        const swatch = this.el('span', 'worklog-type-swatch worklog-pie-legend-swatch');
        swatch.style.background = color;
        item.appendChild(swatch);
        item.appendChild(document.createTextNode(category.label));
        legend.appendChild(item);
      });
      pageText.textContent = `${page + 1}/${pageCount}`;
      prev.disabled = page <= 0;
      next.disabled = page >= pageCount - 1;
    };
    prev.addEventListener('click', () => {
      page -= 1;
      renderLegendPage();
    });
    next.addEventListener('click', () => {
      page += 1;
      renderLegendPage();
    });
    renderLegendPage();
    legendWrap.appendChild(legend);
    legendWrap.appendChild(prev);
    legendWrap.appendChild(pageText);
    legendWrap.appendChild(next);
    const content = this.el('div', 'worklog-pie-content');
    content.appendChild(visual);
    content.appendChild(legendWrap);
    panel.appendChild(content);
    return panel;
  }

  showPieTooltip(event, visual, tooltip, category, color) {
    this.renderPieTooltip(tooltip, category, color);
    this.positionYearTooltip(event, visual, tooltip);
    tooltip.classList.add('is-visible');
  }

  hidePieTooltip(tooltip) {
    tooltip.classList.remove('is-visible');
  }

  renderPieTooltip(tooltip, category, color) {
    tooltip.textContent = '';
    tooltip.style.setProperty('--worklog-tooltip-color', color);
    tooltip.appendChild(this.tooltipMetricRow(category.label, String(category.tasks), color));
    tooltip.appendChild(this.tooltipMetricRow('占比', formatPercent(category.taskRatio), color, true));
  }

  centerPieTooltip(visual, target, tooltip, category, color) {
    this.renderPieTooltip(tooltip, category, color);
    const rect = visual.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const tipWidth = tooltip.offsetWidth || 156;
    const tipHeight = tooltip.offsetHeight || 70;
    const left = Math.min(Math.max(targetRect.left - rect.left + targetRect.width / 2 - tipWidth / 2, 8), Math.max(8, visual.clientWidth - tipWidth - 8));
    const top = Math.min(Math.max(targetRect.top - rect.top + targetRect.height / 2 - tipHeight / 2, 8), Math.max(8, visual.clientHeight - tipHeight - 8));
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    tooltip.classList.add('is-visible');
  }

  positionYearTooltip(event, visual, tooltip) {
    const rect = visual.getBoundingClientRect();
    const tipWidth = tooltip.offsetWidth || 156;
    const tipHeight = tooltip.offsetHeight || 76;
    const left = Math.min(Math.max(event.clientX - rect.left + 12, 8), Math.max(8, visual.clientWidth - tipWidth - 8));
    const top = Math.min(Math.max(event.clientY - rect.top + 12, 8), Math.max(8, visual.clientHeight - tipHeight - 8));
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  tooltipMetricRow(label, value, color, muted = false) {
    const row = this.el('div', `worklog-year-tooltip-row ${muted ? 'is-muted' : ''}`.trim());
    const dot = this.el('span', 'worklog-year-tooltip-dot');
    dot.style.background = color;
    row.appendChild(dot);
    row.appendChild(this.el('span', '', label));
    row.appendChild(this.el('b', '', value));
    return row;
  }

  summaryStat(label, value, tone = '') {
    const item = this.el('div', `worklog-year-stat ${tone ? `worklog-year-stat-${tone}` : ''}`.trim());
    item.appendChild(this.el('span', '', label));
    item.appendChild(this.el('strong', '', value));
    return item;
  }

  renderMonthlyLineChart(summary) {
    const panel = this.el('div', 'worklog-year-panel worklog-line-panel');
    panel.appendChild(this.el('div', 'worklog-year-panel-title', '每月工时统计'));
    const visual = this.el('div', 'worklog-line-visual');
    const tooltip = this.el('div', 'worklog-year-tooltip worklog-line-tooltip');
    const months = Array.from({ length: 12 }, (_, index) => {
      const monthId = `${summary.year}-${pad2(index + 1)}`;
      return summary.months.find((month) => month.month === monthId) || { month: monthId, plannedHours: 0, actualHours: 0 };
    });
    const values = months.flatMap((month) => [month.plannedHours, month.actualHours]);
    const max = chartScaleMax(Math.max(1, ...values));
    const width = 720;
    const height = 300;
    const pad = { left: 52, right: 24, top: 28, bottom: 54 };
    const x = (index) => pad.left + (index / 11) * (width - pad.left - pad.right);
    const y = (value) => pad.top + (1 - value / max) * (height - pad.top - pad.bottom);
    const pointsFor = (key) => months.map((month, index) => ({ x: x(index), y: y(month[key]), value: month[key], month: month.month }));
    const planned = pointsFor('plannedHours');
    const actual = pointsFor('actualHours');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'worklog-line-chart');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `${summary.year} 每月计划工时和实际工时折线图`);
    const highlightLayer = this.svgEl('g', { class: 'worklog-line-highlight-layer' });
    const targetLayer = this.svgEl('g', { class: 'worklog-line-target-layer' });
    months.forEach((month, index) => {
      const left = index === 0 ? pad.left : (x(index - 1) + x(index)) / 2;
      const right = index === months.length - 1 ? width - pad.right : (x(index) + x(index + 1)) / 2;
      const marker = this.svgEl('rect', {
        x: left,
        y: pad.top,
        width: Math.max(1, right - left),
        height: height - pad.top - pad.bottom,
        class: 'worklog-line-hover-marker'
      });
      const target = this.svgEl('rect', {
        x: left,
        y: pad.top,
        width: Math.max(1, right - left),
        height: height - pad.top - pad.bottom,
        class: 'worklog-line-hover-target',
        tabindex: '0',
        'aria-label': `${month.month}：计划 ${formatHours(month.plannedHours)}h，实际 ${formatHours(month.actualHours)}h`
      });
      target.addEventListener('mousemove', (event) => this.showLineTooltip(event, visual, tooltip, marker, month));
      target.addEventListener('mouseenter', (event) => this.showLineTooltip(event, visual, tooltip, marker, month));
      target.addEventListener('mouseleave', () => this.hideLineTooltip(tooltip, marker));
      target.addEventListener('focus', () => this.centerLineTooltip(visual, target, tooltip, marker, month));
      target.addEventListener('blur', () => this.hideLineTooltip(tooltip, marker));
      highlightLayer.appendChild(marker);
      targetLayer.appendChild(target);
    });
    svg.appendChild(highlightLayer);
    chartTicks(max).forEach((tick) => {
      const gy = y(tick);
      svg.appendChild(this.svgEl('line', { x1: pad.left, y1: gy, x2: width - pad.right, y2: gy, class: 'worklog-line-grid' }));
      const label = this.svgEl('text', { x: pad.left - 12, y: gy + 4, class: 'worklog-line-y-label', 'text-anchor': 'end' });
      label.textContent = formatHours(tick);
      svg.appendChild(label);
    });
    svg.appendChild(this.svgEl('path', { d: this.linePath(planned), class: 'worklog-line-path planned' }));
    svg.appendChild(this.svgEl('path', { d: this.linePath(actual), class: 'worklog-line-path actual' }));
    months.forEach((month, index) => {
      const label = this.svgEl('text', { x: x(index), y: height - 14, class: 'worklog-line-x-label', 'text-anchor': 'end', transform: `rotate(-55 ${x(index)} ${height - 14})` });
      label.textContent = month.month;
      svg.appendChild(label);
    });
    this.renderLinePoints(svg, planned, 'planned');
    this.renderLinePoints(svg, actual, 'actual');
    svg.appendChild(targetLayer);
    visual.appendChild(svg);
    visual.appendChild(tooltip);
    panel.appendChild(visual);
    const legend = this.el('div', 'worklog-line-legend');
    legend.appendChild(this.legendItem('计划工时', '#64748b'));
    legend.appendChild(this.legendItem('实际工时', '#ff5c7c'));
    panel.appendChild(legend);
    return panel;
  }

  showLineTooltip(event, visual, tooltip, marker, month) {
    this.renderLineTooltip(tooltip, month);
    this.positionYearTooltip(event, visual, tooltip);
    marker.classList.add('is-visible');
    tooltip.classList.add('is-visible');
  }

  hideLineTooltip(tooltip, marker) {
    marker.classList.remove('is-visible');
    tooltip.classList.remove('is-visible');
  }

  centerLineTooltip(visual, target, tooltip, marker, month) {
    this.renderLineTooltip(tooltip, month);
    const rect = visual.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const tipWidth = tooltip.offsetWidth || 172;
    const tipHeight = tooltip.offsetHeight || 96;
    const left = Math.min(Math.max(targetRect.left - rect.left + targetRect.width / 2 - tipWidth / 2, 8), Math.max(8, visual.clientWidth - tipWidth - 8));
    const top = Math.min(Math.max(targetRect.top - rect.top + targetRect.height / 2 - tipHeight / 2, 8), Math.max(8, visual.clientHeight - tipHeight - 8));
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    marker.classList.add('is-visible');
    tooltip.classList.add('is-visible');
  }

  renderLineTooltip(tooltip, month) {
    tooltip.textContent = '';
    tooltip.appendChild(this.el('strong', 'worklog-year-tooltip-title', month.month));
    tooltip.appendChild(this.tooltipMetricRow('计划工时', `${formatHours(month.plannedHours)}h`, '#64748b'));
    tooltip.appendChild(this.tooltipMetricRow('实际工时', `${formatHours(month.actualHours)}h`, '#ff5c7c'));
  }

  renderLinePoints(svg, points, tone) {
    points.forEach((point) => {
      svg.appendChild(this.svgEl('circle', { cx: point.x, cy: point.y, r: 4, class: `worklog-line-point ${tone}` }));
      if (point.value <= 0) return;
      const label = this.svgEl('text', { x: point.x, y: point.y - 10, class: 'worklog-line-value', 'text-anchor': 'middle' });
      label.textContent = formatHours(point.value);
      svg.appendChild(label);
    });
  }

  linePath(points) {
    return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
  }

  polarPoint(cx, cy, radius, angle) {
    const radians = (angle * Math.PI) / 180;
    return {
      x: cx + radius * Math.cos(radians),
      y: cy + radius * Math.sin(radians)
    };
  }

  donutSlicePath(cx, cy, outerRadius, innerRadius, startAngle, endAngle) {
    if (endAngle - startAngle >= 359.99) {
      return [
        `M ${cx} ${cy - outerRadius}`,
        `A ${outerRadius} ${outerRadius} 0 1 1 ${cx} ${cy + outerRadius}`,
        `A ${outerRadius} ${outerRadius} 0 1 1 ${cx} ${cy - outerRadius}`,
        `M ${cx} ${cy - innerRadius}`,
        `A ${innerRadius} ${innerRadius} 0 1 0 ${cx} ${cy + innerRadius}`,
        `A ${innerRadius} ${innerRadius} 0 1 0 ${cx} ${cy - innerRadius}`,
        'Z'
      ].join(' ');
    }
    const normalizedEnd = endAngle;
    const outerStart = this.polarPoint(cx, cy, outerRadius, startAngle);
    const outerEnd = this.polarPoint(cx, cy, outerRadius, normalizedEnd);
    const innerEnd = this.polarPoint(cx, cy, innerRadius, normalizedEnd);
    const innerStart = this.polarPoint(cx, cy, innerRadius, startAngle);
    const largeArc = normalizedEnd - startAngle > 180 ? 1 : 0;
    return [
      `M ${outerStart.x.toFixed(2)} ${outerStart.y.toFixed(2)}`,
      `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x.toFixed(2)} ${outerEnd.y.toFixed(2)}`,
      `L ${innerEnd.x.toFixed(2)} ${innerEnd.y.toFixed(2)}`,
      `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x.toFixed(2)} ${innerStart.y.toFixed(2)}`,
      'Z'
    ].join(' ');
  }

  legendItem(label, color) {
    const item = this.el('span', 'worklog-line-legend-item');
    const swatch = this.el('span', 'worklog-line-legend-swatch');
    swatch.style.background = color;
    item.appendChild(swatch);
    item.appendChild(document.createTextNode(label));
    return item;
  }

  svgEl(tag, attrs) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
    return node;
  }
}

class TaskModal extends Modal {
  constructor(app, view, selectedDate) {
    super(app);
    this.view = view;
    this.selectedDate = selectedDate || '';
  }

  onOpen() {
    this.setTitle('新增任务');
    const form = this.contentEl;
    const category = this.addSelect('任务类型', categoriesForData(this.view.data).filter((item) => item.enabled !== false));
    const name = this.addInput('任务名称');
    const issue = this.addInput('任务 issue');
    const planned = this.addInput('计划工时', '8', 'number');
    const id = nextTaskId(this.view.data.tasks, this.view.data.month, this.selectedDate || `${this.view.data.month}-01`);
    new Setting(form).setName('任务 ID').setDesc(id);
    const hours = this.selectedDate ? this.addInput('当天工时', '1', 'number') : null;
    const work = this.selectedDate ? this.addTextArea('当天做了什么') : null;
    new Setting(form).addButton((button) => button.setButtonText('新增任务').setCta().onClick(async () => {
      if (!clean(name.value)) return new Notice('任务名称不能为空');
      if (!clean(issue.value)) return new Notice('任务 issue 不能为空');
      if (!category.value) return new Notice('请先在插件设置中启用至少一个任务类型');
      const taskId = nextTaskId(this.view.data.tasks, this.view.data.month, this.selectedDate || `${this.view.data.month}-01`);
      const task = { id: taskId, name: clean(name.value), category: category.value, issue: clean(issue.value), plannedHours: toNumber(planned.value), status: 'doing' };
      if (task.plannedHours <= 0) return new Notice('计划工时必须大于 0');
      const logs = this.view.data.logs.slice();
      if (this.selectedDate) {
        if (hasLogForTaskDate(logs, taskId, this.selectedDate)) return new Notice('当天已登记过该任务 ID');
        if (!clean(work.value)) return new Notice('当天工作内容不能为空');
        logs.push({ id: `log-${Date.now().toString(36)}`, date: this.selectedDate, taskId, hours: toNumber(hours.value), work: clean(work.value), issueLink: '' });
      }
      await this.view.save(Object.assign({}, this.view.data, { tasks: this.view.data.tasks.concat(task), logs }));
      new Notice(`已新增任务：${taskId}`);
      this.close();
    }));
  }

  addInput(label, value = '', type = 'text') {
    let input;
    new Setting(this.contentEl).setName(label).addText((text) => {
      input = text.inputEl;
      input.type = type;
      input.value = value;
    });
    return input;
  }

  addTextArea(label) {
    let input;
    new Setting(this.contentEl).setName(label).addTextArea((text) => {
      input = text.inputEl;
    });
    return input;
  }

  addSelect(label, options) {
    let select;
    new Setting(this.contentEl).setName(label).addDropdown((dropdown) => {
      options.forEach((option) => dropdown.addOption(option.id, option.label));
      select = dropdown.selectEl;
    });
    return select;
  }
}

class LogModal extends Modal {
  constructor(app, view, selectedDate) {
    super(app);
    this.view = view;
    const today = todayIso();
    this.selectedDate = selectedDate || (today.startsWith(view.data.month) ? today : `${view.data.month}-01`);
  }

  onOpen() {
    this.setTitle('新增工时');
    const taskSelect = this.addTaskSelect();
    const date = this.addInput('日期', this.selectedDate, 'date');
    const hours = this.addInput('工时', '1', 'number');
    const work = this.addTextArea('今天具体做了什么');
    const issue = this.addInput('关联 issue');
    new Setting(this.contentEl).addButton((button) => button.setButtonText('登记工时').setCta().onClick(async () => {
      const task = this.view.data.tasks.find((item) => item.id === taskSelect.value);
      if (!task) return new Notice('请选择任务');
      if (!clean(date.value).startsWith(this.view.data.month)) return new Notice(`日期必须属于当前月 ${this.view.data.month}`);
      if (hasLogForTaskDate(this.view.data.logs, task.id, date.value)) return new Notice(`当天已登记过该任务 ID：${task.id}`);
      const category = categoriesForData(this.view.data).find((item) => item.id === task.category);
      if (category && category.requiresLogIssue && !clean(issue.value)) return new Notice('该任务类型必须填写关联 issue');
      if (!clean(work.value)) return new Notice('工作内容不能为空');
      const log = { id: `log-${Date.now().toString(36)}`, date: date.value, taskId: task.id, hours: toNumber(hours.value), work: clean(work.value), issueLink: clean(issue.value) };
      if (log.hours <= 0) return new Notice('工时必须大于 0');
      await this.view.save(Object.assign({}, this.view.data, { logs: this.view.data.logs.concat(log) }));
      new Notice(`已登记 ${formatHours(log.hours)}h`);
      this.close();
    }));
  }

  addTaskSelect() {
    let select;
    new Setting(this.contentEl).setName('任务').addDropdown((dropdown) => {
      this.view.data.tasks.forEach((task) => dropdown.addOption(task.id, `${task.id} | ${task.name}`));
      select = dropdown.selectEl;
    });
    return select;
  }

  addInput(label, value = '', type = 'text') {
    let input;
    new Setting(this.contentEl).setName(label).addText((text) => {
      input = text.inputEl;
      input.type = type;
      input.value = value;
    });
    return input;
  }

  addTextArea(label) {
    let input;
    new Setting(this.contentEl).setName(label).addTextArea((text) => {
      input = text.inputEl;
    });
    return input;
  }
}

class WorklogSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Worklog 设置' });
    new Setting(containerEl)
      .setName('新建月度笔记并实时同步数据')
      .setDesc('关闭时只创建和维护本地 JSON 数据；开启后会为打开的月份创建月度笔记，并在工时数据变化时同步看板、日历、任务和明细。')
      .addToggle((toggle) => toggle.setValue(!!this.plugin.settings.createMonthlyNote).onChange(async (value) => {
        this.plugin.settings.createMonthlyNote = value;
        await this.plugin.saveSettings();
        if (value) {
          const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
          const months = leaves.map((leaf) => leaf.view && leaf.view.month).filter(isValidMonth);
          const targetMonths = months.length ? Array.from(new Set(months)) : [currentMonth()];
          for (const month of targetMonths) {
            const data = await this.plugin.readData(month);
            await this.plugin.syncMonthNote(data);
          }
          new Notice('已开启月度笔记实时同步');
        } else {
          new Notice('已关闭月度笔记实时同步');
        }
      }));
    new Setting(containerEl).setName('月度笔记目录').addText((text) => text.setValue(this.plugin.settings.worklogFolder).onChange(async (value) => {
      this.plugin.settings.worklogFolder = clean(value) || DEFAULT_SETTINGS.worklogFolder;
      await this.plugin.saveSettings();
    }));
    new Setting(containerEl).setName('数据目录').addText((text) => text.setValue(this.plugin.settings.dataFolder).onChange(async (value) => {
      this.plugin.settings.dataFolder = clean(value) || DEFAULT_SETTINGS.dataFolder;
      await this.plugin.saveSettings();
    }));
    containerEl.createEl('h3', { text: '任务类型管理' });
    containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: '停用后不会出现在新建任务下拉框中，也不会参与新月份默认任务生成；历史任务和统计仍会按原类型显示。'
    });
    this.renderTaskTypeHeader(containerEl);
    this.renderTaskTypes(containerEl);
    new Setting(containerEl).setClass('worklog-setting-add-row').addButton((button) => this.iconButton(button, 'plus', '新增任务类型', 'worklog-setting-add-button', true).onClick(async () => {
      const next = this.plugin.settings.taskTypes.slice();
      next.push({ id: makeId('type'), label: '新任务类型', color: categoryColor('', next.length), enabled: true, requiresLogIssue: false, sort: next.length });
      this.plugin.settings.taskTypes = normalizeTaskTypes(next);
      await this.plugin.saveSettings();
      this.display();
    }));
    containerEl.createEl('h3', { text: '默认任务模板' });
    containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: '用于创建新月份时自动生成任务；停用模板不会影响已经创建出来的历史任务。'
    });
    this.renderTemplateHeader(containerEl);
    this.renderTaskTemplates(containerEl);
    new Setting(containerEl).setClass('worklog-setting-add-row').addButton((button) => this.iconButton(button, 'plus', '新增默认任务模板', 'worklog-setting-add-button', true).onClick(async () => {
      const taskTypes = normalizeTaskTypes(this.plugin.settings.taskTypes);
      if (!taskTypes.length) {
        new Notice('请先新增任务类型，再新增默认任务模板');
        return;
      }
      const next = this.plugin.settings.defaultTaskTemplates.slice();
      next.push({
        id: makeId('tpl'),
        name: '新默认任务',
        category: (taskTypes.find((item) => item.enabled !== false) || taskTypes[0]).id,
        issue: '',
        plannedHours: 1,
        status: 'doing',
        enabled: true,
        sort: next.length
      });
      this.plugin.settings.defaultTaskTemplates = normalizeTaskTemplates(next, taskTypes);
      await this.plugin.saveSettings();
      this.display();
    }));
  }

  iconButton(button, icon, label, extraClass = '', showTooltip = false) {
    if (typeof button.setIcon === 'function') button.setIcon(icon);
    else button.setButtonText(label);
    if (showTooltip) button.buttonEl.setAttribute('aria-label', label);
    else button.buttonEl.removeAttribute('aria-label');
    button.buttonEl.classList.add('worklog-setting-icon-button');
    if (extraClass) button.buttonEl.classList.add(extraClass);
    return button;
  }

  async updateTaskType(id, patch) {
    const next = this.plugin.settings.taskTypes.map((item) => item.id === id ? Object.assign({}, item, patch) : item);
    this.plugin.settings.taskTypes = normalizeTaskTypes(next);
    this.plugin.settings.defaultTaskTemplates = normalizeTaskTemplates(this.plugin.settings.defaultTaskTemplates, this.plugin.settings.taskTypes);
    await this.plugin.saveSettings();
    this.plugin.refreshOpenViews();
  }

  async updateTaskTemplate(id, patch) {
    const next = this.plugin.settings.defaultTaskTemplates.map((item) => item.id === id ? Object.assign({}, item, patch) : item);
    this.plugin.settings.defaultTaskTemplates = normalizeTaskTemplates(next, this.plugin.settings.taskTypes);
    await this.plugin.saveSettings();
  }

  async reorderTaskTypes(sourceId, targetId, afterTarget) {
    const next = this.moveItemTo(this.plugin.settings.taskTypes, sourceId, targetId, afterTarget);
    this.plugin.settings.taskTypes = normalizeTaskTypes(next.map((item, index) => Object.assign({}, item, { sort: index })));
    await this.plugin.saveSettings();
    this.plugin.refreshOpenViews();
    this.display();
  }

  async reorderTaskTemplates(sourceId, targetId, afterTarget) {
    const next = this.moveItemTo(this.plugin.settings.defaultTaskTemplates, sourceId, targetId, afterTarget);
    this.plugin.settings.defaultTaskTemplates = normalizeTaskTemplates(next.map((item, index) => Object.assign({}, item, { sort: index })), this.plugin.settings.taskTypes);
    await this.plugin.saveSettings();
    this.display();
  }

  async deleteTaskTemplate(id) {
    const template = this.plugin.settings.defaultTaskTemplates.find((item) => item.id === id);
    const name = template ? template.name : id;
    if (!confirm(`删除默认任务模板“${name}”？\n\n删除后，新月份不会再自动生成这个默认任务，已创建的历史任务不受影响。`)) return;
    const next = this.plugin.settings.defaultTaskTemplates
      .filter((item) => item.id !== id)
      .map((item, index) => Object.assign({}, item, { sort: index }));
    this.plugin.settings.defaultTaskTemplates = normalizeTaskTemplates(next, this.plugin.settings.taskTypes);
    await this.plugin.saveSettings();
    this.display();
    new Notice('已删除默认任务模板');
  }

  async usedTaskTypeIds() {
    const used = new Set();
    const dataItems = await this.plugin.readAllExistingData();
    dataItems.forEach((data) => {
      (data.tasks || []).forEach((task) => {
        const id = clean(task.category);
        if (id) used.add(id);
      });
    });
    return used;
  }

  async deleteTaskType(id) {
    const used = await this.usedTaskTypeIds();
    if (used.has(id)) {
      new Notice('该任务类型已有历史任务，不能删除，可以停用');
      return;
    }
    const type = this.plugin.settings.taskTypes.find((item) => item.id === id);
    const name = type ? type.label : id;
    const templateCount = this.plugin.settings.defaultTaskTemplates.filter((item) => item.category === id).length;
    const templateHint = templateCount ? `\n\n同时会移除 ${templateCount} 个使用该类型的默认任务模板。` : '';
    if (!confirm(`删除任务类型“${name}”？\n\n只有未被历史任务使用的类型才能删除。删除后无法在新任务中选择该类型。${templateHint}`)) return;
    const nextTypes = this.plugin.settings.taskTypes
      .filter((item) => item.id !== id)
      .map((item, index) => Object.assign({}, item, { sort: index }));
    this.plugin.settings.taskTypes = normalizeTaskTypes(nextTypes);
    this.plugin.settings.defaultTaskTemplates = normalizeTaskTemplates(
      this.plugin.settings.defaultTaskTemplates.filter((item) => item.category !== id),
      this.plugin.settings.taskTypes
    );
    await this.plugin.saveSettings();
    this.plugin.refreshOpenViews();
    this.display();
    new Notice('已删除未使用的任务类型');
  }

  moveItemTo(items, sourceId, targetId, afterTarget) {
    const next = items.slice();
    const sourceIndex = next.findIndex((item) => item.id === sourceId);
    const targetIndex = next.findIndex((item) => item.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return next;
    const [item] = next.splice(sourceIndex, 1);
    const adjustedTarget = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
    const insertIndex = Math.max(0, Math.min(next.length, adjustedTarget + (afterTarget ? 1 : 0)));
    next.splice(insertIndex, 0, item);
    return next;
  }

  clearDragTargets() {
    document.querySelectorAll('.worklog-setting-drop-before, .worklog-setting-drop-after, .worklog-setting-row-dragging').forEach((el) => {
      el.classList.remove('worklog-setting-drop-before', 'worklog-setting-drop-after', 'worklog-setting-row-dragging');
    });
  }

  attachDragHandle(rowEl, group, id) {
    const handle = rowEl.createDiv({ cls: 'worklog-setting-drag-handle', attr: { draggable: 'true' } });
    handle.setAttribute('aria-hidden', 'true');
    handle.createSpan();
    handle.createSpan();
    handle.createSpan();
    handle.createSpan();
    handle.createSpan();
    handle.createSpan();
    handle.addEventListener('dragstart', (event) => {
      this.dragSortState = { group, id };
      rowEl.classList.add('worklog-setting-row-dragging');
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', id);
      }
    });
    handle.addEventListener('dragend', () => {
      this.dragSortState = null;
      this.clearDragTargets();
    });
    return handle;
  }

  attachDropTarget(rowEl, group, id) {
    rowEl.addEventListener('dragover', (event) => {
      if (!this.dragSortState || this.dragSortState.group !== group || this.dragSortState.id === id) return;
      event.preventDefault();
      const rect = rowEl.getBoundingClientRect();
      const afterTarget = event.clientY > rect.top + rect.height / 2;
      rowEl.classList.toggle('worklog-setting-drop-before', !afterTarget);
      rowEl.classList.toggle('worklog-setting-drop-after', afterTarget);
    });
    rowEl.addEventListener('dragleave', () => {
      rowEl.classList.remove('worklog-setting-drop-before', 'worklog-setting-drop-after');
    });
    rowEl.addEventListener('drop', async (event) => {
      if (!this.dragSortState || this.dragSortState.group !== group || this.dragSortState.id === id) return;
      event.preventDefault();
      const sourceId = this.dragSortState.id;
      const rect = rowEl.getBoundingClientRect();
      const afterTarget = event.clientY > rect.top + rect.height / 2;
      this.dragSortState = null;
      this.clearDragTargets();
      if (group === 'taskTypes') await this.reorderTaskTypes(sourceId, id, afterTarget);
      if (group === 'taskTemplates') await this.reorderTaskTemplates(sourceId, id, afterTarget);
    });
  }

  renderTaskTypes(containerEl) {
    this.plugin.settings.taskTypes.forEach((category, index, list) => {
      const setting = new Setting(containerEl).setClass('worklog-setting-row');
      setting.settingEl.classList.add('worklog-setting-row-type');
      this.attachDragHandle(setting.settingEl, 'taskTypes', category.id);
      this.attachDropTarget(setting.settingEl, 'taskTypes', category.id);
      setting.setName(`类型 ${index + 1}`).setDesc(category.enabled === false ? '已停用' : '已启用');
      setting.addText((text) => text.setPlaceholder('显示名称').setValue(category.label).onChange(async (value) => {
        await this.updateTaskType(category.id, { label: clean(value) || category.id });
      }));
      setting.addText((text) => {
        text.inputEl.type = 'color';
        text.setValue(categoryColorForData(category, index)).onChange(async (value) => {
          await this.updateTaskType(category.id, { color: clean(value) || categoryColor(category.id, index) });
        });
      });
      setting.addToggle((toggle) => {
        toggle.setValue(category.enabled !== false).onChange(async (value) => {
          await this.updateTaskType(category.id, { enabled: value });
          this.display();
        });
      });
      setting.addToggle((toggle) => {
        toggle.setValue(category.requiresLogIssue === true).onChange(async (value) => {
          await this.updateTaskType(category.id, { requiresLogIssue: value });
        });
      });
      setting.addButton((button) => this.iconButton(button, 'trash-2', '删除', 'worklog-setting-danger-button').onClick(() => this.deleteTaskType(category.id)));
    });
  }

  renderTaskTypeHeader(containerEl) {
    const header = containerEl.createDiv({ cls: 'worklog-setting-header worklog-setting-header-type' });
    header.createEl('span', { text: '类型' });
    ['类型名称', '颜色', '启用', '需 issue', '删除'].forEach((label) => {
      header.createEl('span', { text: label });
    });
  }

  renderTemplateHeader(containerEl) {
    const header = containerEl.createDiv({ cls: 'worklog-setting-header worklog-setting-header-template' });
    header.createEl('span', { text: '模板' });
    ['任务名称', '任务类型', '计划工时', '启用', '删除'].forEach((label) => {
      header.createEl('span', { text: label });
    });
  }

  renderTaskTemplates(containerEl) {
    const taskTypes = normalizeTaskTypes(this.plugin.settings.taskTypes);
    this.plugin.settings.defaultTaskTemplates.forEach((template, index, list) => {
      const setting = new Setting(containerEl).setClass('worklog-setting-row');
      setting.settingEl.classList.add('worklog-setting-row-template');
      this.attachDragHandle(setting.settingEl, 'taskTemplates', template.id);
      this.attachDropTarget(setting.settingEl, 'taskTemplates', template.id);
      setting.setName(`模板 ${index + 1}`).setDesc(template.enabled === false ? '已停用' : '已启用');
      setting.addText((text) => text.setPlaceholder('任务名称').setValue(template.name).onChange(async (value) => {
        await this.updateTaskTemplate(template.id, { name: clean(value) || template.name });
      }));
      setting.addDropdown((dropdown) => {
        taskTypes.forEach((category) => dropdown.addOption(category.id, `${category.label}${category.enabled === false ? '（已停用）' : ''}`));
        dropdown.setValue(template.category);
        dropdown.onChange(async (value) => {
          await this.updateTaskTemplate(template.id, { category: value });
        });
      });
      setting.addText((text) => {
        text.inputEl.type = 'number';
        text.inputEl.min = '0';
        text.inputEl.step = '0.5';
        text.setValue(String(template.plannedHours)).onChange(async (value) => {
          await this.updateTaskTemplate(template.id, { plannedHours: toNumber(value) });
        });
      });
      setting.addToggle((toggle) => {
        toggle.setValue(template.enabled !== false).onChange(async (value) => {
          await this.updateTaskTemplate(template.id, { enabled: value });
          this.display();
        });
      });
      setting.addButton((button) => this.iconButton(button, 'trash-2', '删除', 'worklog-setting-danger-button').onClick(() => this.deleteTaskTemplate(template.id)));
    });
  }
}

module.exports = WorklogPlugin;
