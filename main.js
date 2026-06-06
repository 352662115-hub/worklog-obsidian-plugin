const { Plugin, ItemView, Notice, Modal, Setting, PluginSettingTab, setIcon } = require('obsidian');

const VIEW_TYPE = 'worklog-view';
const YEAR_VIEW_TYPE = 'worklog-year-view';
const CONFIG_FILE_NAME = 'config.json';
const DATA_FOLDER_NAME = 'data';
const DEFAULT_SETTINGS = {
  worklogFolder: 'worklog',
  dataFolder: '',
  createMonthlyReport: false,
  taskTypes: [],
  defaultTaskTemplates: []
};

const DEFAULT_MONTHLY_REPORT_TEMPLATE = `---
type: worklog-monthly-report
month: {{month}}
system: Worklog Plugin
data: {{dataPath}}
created: {{createdAt}}
---

# {{monthTitle}}月度终结报告

> 本报告由 Worklog 插件在每月 1 日读取上月数据创建。报告只读取数据，不会修改源 JSON；报告创建后不会被插件覆盖，可以直接在本文继续补充复盘内容。

## 本月概览

{{overviewTable}}
## 任务状态

{{statusTable}}
## 任务类型

{{categoryTable}}
## 项目汇总

{{projectTable}}
## 已完成任务

{{completedTaskTable}}
## 延续任务

{{carryTaskTable}}
## 工时明细

{{logTable}}
## 月度复盘

### 完成亮点

-

### 问题与风险

-

### 下月计划

-
`;

const DEFAULT_ANNUAL_REPORT_TEMPLATE = `---
type: worklog-annual-report
year: {{year}}
system: Worklog Plugin
dataFolder: {{dataFolder}}
created: {{createdAt}}
---

# {{year}} 年度终结报告

> 本报告由 Worklog 插件在每年 1 月 1 日读取上一年度数据创建。报告只读取数据，不会修改源 JSON；报告创建后不会被插件覆盖，可以直接在本文继续补充复盘内容。

## 年度概览

{{overviewTable}}
## 任务状态

{{statusTable}}
## 任务统计

{{categoryTable}}
## 项目汇总

{{projectTable}}
## 月度明细

{{monthTable}}
## 年度复盘

### 完成亮点

-

### 问题与风险

-

### 下一年度计划

-
`;

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

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
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

function todayIsoFromDate(date) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function todayIso() {
  return todayIsoFromDate(new Date());
}

function currentMonth() {
  return todayIso().slice(0, 7);
}

function currentYear() {
  return todayIso().slice(0, 4);
}

function monthFromDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

function previousMonthFromDate(date) {
  return monthFromDate(new Date(date.getFullYear(), date.getMonth() - 1, 1));
}

function previousYearFromDate(date) {
  return String(date.getFullYear() - 1);
}

function isFirstDayOfMonth(date = new Date()) {
  return date.getDate() === 1;
}

function isFirstDayOfYear(date = new Date()) {
  return date.getMonth() === 0 && date.getDate() === 1;
}

function formatMonthTitle(month) {
  const match = clean(month).match(/^(20\d{2})-(\d{2})$/);
  if (!match) return clean(month);
  return `${match[1]} 年 ${Number(match[2])} 月`;
}

function isValidMonth(value) {
  const match = clean(value).match(/^(20\d{2})-(\d{2})$/);
  return !!match && Number(match[2]) >= 1 && Number(match[2]) <= 12;
}

function isValidDate(value) {
  const match = clean(value).match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function normalizeDate(value, month = '') {
  const match = clean(value).match(/^(20\d{2}-\d{2}-\d{2})(?:[T\s].*)?$/);
  const date = match ? match[1] : '';
  if (!isValidDate(date)) return '';
  return isValidMonth(month) && date.slice(0, 7) !== month ? '' : date;
}

function lastDateOfMonth(month) {
  if (!isValidMonth(month)) return '';
  const [year, monthNumber] = month.split('-').map(Number);
  return `${month}-${pad2(new Date(year, monthNumber, 0).getDate())}`;
}

function normalizeMonth(year, month) {
  const y = Number(clean(year));
  const m = Number(clean(month));
  if (!Number.isInteger(y) || y < 2000 || y > 2099 || !Number.isInteger(m) || m < 1 || m > 12) return '';
  return `${y}-${pad2(m)}`;
}

function normalizeYear(value) {
  const year = Number(clean(value));
  if (!Number.isInteger(year) || year < 2000 || year > 2099) return '';
  return String(year);
}

function monthOptions() {
  return Array.from({ length: 12 }, (_, index) => pad2(index + 1));
}

function escapeRegExp(value) {
  return clean(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeFolderPath(value) {
  return clean(value).replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
}

function parentPath(path) {
  const parts = clean(path).split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
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

function formatRemainingHours(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '0';
  return n < 0 ? `-${formatHours(Math.abs(n))}` : formatHours(n);
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
  const source = Array.isArray(taskTypes) ? taskTypes : arrayOrEmpty(fallback);
  source.forEach((item, index) => {
    if (!isPlainObject(item)) return;
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
  const taskTypeList = arrayOrEmpty(taskTypes).filter(isPlainObject);
  const categoryIds = new Set(taskTypeList.map((item) => item.id));
  const source = Array.isArray(templates) ? templates : [];
  return source.map((item, index) => {
    if (!isPlainObject(item)) return null;
    const category = clean(item.category);
    return {
      id: clean(item.id) || makeId('tpl'),
      name: clean(item.name),
      project: clean(item.project || item.projectName || item.belongingProject),
      category: categoryIds.has(category) ? category : (taskTypeList[0] && taskTypeList[0].id) || 'feature',
      issue: clean(item.issue),
      plannedHours: toNumber(item.plannedHours ?? item.planned),
      status: normalizeStatus(item.status),
      enabled: item.enabled !== false,
      sort: Number.isFinite(Number(item.sort)) ? Number(item.sort) : index
    };
  }).filter((item) => item && item.name).sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0) || a.name.localeCompare(b.name));
}

function normalizeSettings(settings) {
  const source = isPlainObject(settings) ? settings : {};
  const taskTypes = normalizeTaskTypes(source.taskTypes);
  const defaultTaskTemplates = normalizeTaskTemplates(source.defaultTaskTemplates, taskTypes);
  return {
    worklogFolder: normalizeFolderPath(source.worklogFolder) || DEFAULT_SETTINGS.worklogFolder,
    dataFolder: normalizeFolderPath(source.dataFolder),
    createMonthlyReport: source.createMonthlyReport === true || source.createMonthlyNote === true,
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
  const taskCategoryIds = new Set(arrayOrEmpty(data && data.tasks).filter(isPlainObject).map((task) => clean(task.category)).filter(Boolean));
  const add = (category) => {
    if (!isPlainObject(category)) return;
    const id = clean(category.id);
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
  arrayOrEmpty(data && data.categories)
    .filter((category) => taskCategoryIds.has(clean(category && category.id)))
    .forEach(add);
  arrayOrEmpty(data && data.tasks).filter(isPlainObject).forEach((task) => add({ id: clean(task.category), label: clean(task.category) }));
  if (categories.length) return categories.sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0) || a.label.localeCompare(b.label));
  return hasConfiguredCategories || hasDataCategories ? [] : defaultTaskTypes();
}

function makeTaskId(date, sequence) {
  return `YZL${date.replace(/-/g, '')}${pad3(sequence)}`;
}

function taskIdDate(month, preferredDate) {
  const date = normalizeDate(preferredDate, month);
  if (date) return date;
  return `${month || currentMonth()}-01`;
}

function nextTaskId(tasks, month, preferredDate) {
  const ids = tasks instanceof Set ? tasks : new Set(arrayOrEmpty(tasks).filter(isPlainObject).map((task) => clean(task.id)).filter(Boolean));
  const date = taskIdDate(month, preferredDate);
  let sequence = 1;
  while (ids.has(makeTaskId(date, sequence))) sequence += 1;
  return makeTaskId(date, sequence);
}

function hasLogForTaskDate(logs, taskId, date, ignoreLogId = '') {
  return arrayOrEmpty(logs).filter(isPlainObject).some((log) => clean(log.taskId) === clean(taskId) && clean(log.date) === clean(date) && (!ignoreLogId || clean(log.id) !== clean(ignoreLogId)));
}

function statusClass(status) {
  return `worklog-task-status-${(clean(status) || 'unknown').replace(/[^a-z0-9_-]/gi, '-').toLowerCase()}`;
}

function normalizeStatus(value, fallback = 'doing') {
  const status = clean(value) || fallback;
  return STATUSES.some((item) => item.id === status) ? status : fallback;
}

function defaultData(month, settings = DEFAULT_SETTINGS) {
  const sourceSettings = isPlainObject(settings) ? settings : DEFAULT_SETTINGS;
  const taskTypes = normalizeTaskTypes(sourceSettings.taskTypes);
  const enabledTypeIds = new Set(taskTypes.filter((item) => item.enabled !== false).map((item) => item.id));
  const templates = normalizeTaskTemplates(sourceSettings.defaultTaskTemplates, taskTypes)
    .filter((item) => item.enabled !== false && enabledTypeIds.has(item.category));
  const usedIds = new Set();
  const tasks = templates.map((task) => {
    const id = nextTaskId(usedIds, month, `${month}-01`);
    usedIds.add(id);
    return {
      id,
      name: task.name,
      project: task.project || '',
      category: task.category,
      issue: task.issue || '',
      plannedHours: toNumber(task.plannedHours),
      status: normalizeStatus(task.status)
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
  const sourceSettings = isPlainObject(settings) ? settings : DEFAULT_SETTINGS;
  const source = isPlainObject(raw) ? raw : {};
  const targetMonth = isValidMonth(month) ? month : (isValidMonth(source.month) ? source.month : currentMonth());
  const data = Object.assign(defaultData(targetMonth, sourceSettings), source);
  data.schemaVersion = 2;
  data.month = targetMonth;
  const taskTypes = normalizeTaskTypes(sourceSettings.taskTypes);
  data.categories = categoriesForData(data, taskTypes);
  delete data.statuses;
  data.tasks = arrayOrEmpty(data.tasks).filter(isPlainObject).map((task) => ({
    id: clean(task.id),
    name: clean(task.name),
    project: clean(task.project || task.projectName || task.belongingProject),
    category: clean(task.category || 'feature'),
    issue: clean(task.issue),
    plannedHours: toNumber(task.plannedHours ?? task.planned),
    status: normalizeStatus(task.status)
  })).filter((task) => task.name);
  const usedIds = new Set(data.tasks.map((task) => clean(task.id)).filter(Boolean));
  data.tasks = data.tasks.map((task) => {
    if (task.id) return task;
    const id = nextTaskId(usedIds, data.month, `${data.month}-01`);
    usedIds.add(id);
    return Object.assign({}, task, { id });
  });
  data.logs = arrayOrEmpty(data.logs).filter(isPlainObject).map((log, index) => {
    const date = normalizeDate(log.date, data.month);
    const taskId = clean(log.taskId);
    const hours = toNumber(log.hours);
    if (!date || !taskId || hours <= 0) return null;
    return {
      id: clean(log.id) || `log-${index}-${Date.now().toString(36)}`,
      date,
      taskId,
      hours,
      work: clean(log.work),
      issueLink: clean(log.issueLink || log.issue)
    };
  }).filter(Boolean);
  const completed = isPlainObject(data.dailyStatus) ? arrayOrEmpty(data.dailyStatus.completedDates) : [];
  data.dailyStatus = {
    completedDates: Array.from(new Set(completed.map((date) => normalizeDate(date, data.month)).filter(Boolean))).sort()
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
  const source = isPlainObject(data) ? data : defaultData(currentMonth());
  const tasks = arrayOrEmpty(source.tasks).filter(isPlainObject);
  const logs = arrayOrEmpty(source.logs).filter(isPlainObject);
  const tasksById = new Map();
  const actualByTask = new Map();
  const daily = new Map();
  const dailyCount = new Map();
  const logCountByTask = new Map();
  const categories = categoriesForData(source, source.categories);
  const taskCategoryIds = new Set(tasks.map((task) => clean(task.category)).filter(Boolean));
  const taskCategories = categories.filter((category) => taskCategoryIds.has(category.id));
  const categoryById = new Map(categories.map((item) => [item.id, item]));
  tasks.forEach((task) => tasksById.set(task.id, task));
  logs.forEach((log) => {
    const hours = toNumber(log.hours);
    actualByTask.set(log.taskId, (actualByTask.get(log.taskId) || 0) + hours);
    daily.set(log.date, (daily.get(log.date) || 0) + hours);
    dailyCount.set(log.date, (dailyCount.get(log.date) || 0) + 1);
    logCountByTask.set(log.taskId, (logCountByTask.get(log.taskId) || 0) + 1);
  });
  const totalPlanned = tasks.reduce((sum, task) => sum + toNumber(task.plannedHours), 0);
  const totalActual = logs.reduce((sum, log) => sum + toNumber(log.hours), 0);
  const totalTasks = tasks.length;
  const statusCounts = taskStatusCounts(tasks);
  const completedTasks = statusCounts.done || 0;
  return {
    tasksById,
    actualByTask,
    daily,
    dailyCount,
    logCountByTask,
    categories,
    taskCategories,
    categoryById,
    totalPlanned,
    totalActual,
    totalTasks,
    completedTasks,
    statusCounts
  };
}

function taskStatusCounts(tasks) {
  const counts = Object.fromEntries(STATUSES.map((status) => [status.id, 0]));
  arrayOrEmpty(tasks).filter(isPlainObject).forEach((task) => {
    const status = clean(task.status || 'doing') || 'doing';
    if (Object.prototype.hasOwnProperty.call(counts, status)) counts[status] += 1;
  });
  return counts;
}

function statusCountText(statusCounts) {
  const counts = statusCounts || {};
  return STATUSES.map((status) => `${status.label} ${toNumber(counts[status.id])}`).join(' · ');
}

function completionPercent(completed, total) {
  const done = Math.max(0, toNumber(completed));
  const count = Math.max(0, toNumber(total));
  if (count <= 0) return 0;
  return Math.min(100, Math.round((done / count) * 100));
}

function addModalTitleBadge(modalEl, text) {
  const title = modalEl && modalEl.querySelector ? modalEl.querySelector('.modal-title') : null;
  if (!title || !text) return;
  title.appendChild(Object.assign(document.createElement('span'), {
    className: 'worklog-modal-title-badge',
    textContent: text
  }));
}

function taskTypeRowsForData(data, d = deriveWorklogData(data)) {
  const source = isPlainObject(data) ? data : defaultData(currentMonth());
  const tasks = arrayOrEmpty(source.tasks).filter(isPlainObject);
  const logs = arrayOrEmpty(source.logs).filter(isPlainObject);
  const totalsByCategory = new Map(d.taskCategories.map((category) => [category.id, { planned: 0, actual: 0, tasks: 0 }]));
  tasks.forEach((task) => {
    const totals = totalsByCategory.get(task.category);
    if (!totals) return;
    totals.planned += toNumber(task.plannedHours);
    totals.tasks += 1;
  });
  logs.forEach((log) => {
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
      taskRatio: tasks.length > 0 ? (totals.tasks / tasks.length) * 100 : 0
    };
  }).sort((a, b) => compareCategories(a, b) || b.actual - a.actual || a.label.localeCompare(b.label));
}

function normalizeWorklogItem(item) {
  const data = isPlainObject(item) && isPlainObject(item.data) ? item.data : item;
  if (!isPlainObject(data) || !isValidMonth(data.month)) return null;
  const derived = isPlainObject(item) && isPlainObject(item.d)
    ? item.d
    : (isPlainObject(item) && isPlainObject(item.derived) ? item.derived : null);
  return { data, d: derived };
}

function scopedWorklogItems(items, year = '', month = '') {
  const selectedYear = normalizeYear(year);
  const selectedMonth = selectedYear && isValidMonth(month) && month.startsWith(`${selectedYear}-`) ? month : '';
  return arrayOrEmpty(items)
    .map(normalizeWorklogItem)
    .filter(Boolean)
    .filter(({ data }) => (!selectedYear || data.month.startsWith(`${selectedYear}-`)) && (!selectedMonth || data.month === selectedMonth))
    .sort((a, b) => a.data.month.localeCompare(b.data.month))
    .map(({ data, d }) => ({ data, d: d || deriveWorklogData(data) }));
}

function yearSummary(items) {
  const byYear = new Map();
  scopedWorklogItems(items).forEach(({ data, d }) => {
    const year = data.month.slice(0, 4);
    if (!byYear.has(year)) {
      byYear.set(year, {
        year,
        months: [],
        totalPlanned: 0,
        totalActual: 0,
        totalLogs: 0,
        totalTasks: 0,
        completedTasks: 0,
        statusCounts: taskStatusCounts([]),
        taskIds: new Set(),
        categories: new Map()
      });
    }
    const summary = byYear.get(year);
    const tasks = arrayOrEmpty(data.tasks).filter(isPlainObject);
    const logs = arrayOrEmpty(data.logs).filter(isPlainObject);
    tasks.forEach((task) => {
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
    logs.forEach((log) => {
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
    summary.totalLogs += logs.length;
    summary.totalTasks += tasks.length;
    summary.completedTasks += d.completedTasks;
    STATUSES.forEach((status) => {
      summary.statusCounts[status.id] += d.statusCounts[status.id] || 0;
    });
    summary.months.push({
      month: data.month,
      plannedHours: d.totalPlanned,
      actualHours: d.totalActual,
      logs: logs.length,
      tasks: tasks.length
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

function projectRowsForScope(items, year, month = '') {
  const selectedYear = normalizeYear(year);
  const selectedMonth = isValidMonth(month) && month.startsWith(`${selectedYear}-`) ? month : '';
  const projects = new Map();
  let totalPlanned = 0;
  let totalActual = 0;
  let totalTasks = 0;
  let totalLogs = 0;

  const ensureProject = (name) => {
    const project = clean(name) || '未归属项目';
    if (!projects.has(project)) {
      projects.set(project, {
        project,
        months: new Set(),
        categories: new Set(),
        issues: new Set(),
        planned: 0,
        actual: 0,
        tasks: 0,
        logs: 0
      });
    }
    return projects.get(project);
  };

  scopedWorklogItems(items, selectedYear, selectedMonth)
    .forEach(({ data, d }) => {
      arrayOrEmpty(data.tasks).filter(isPlainObject).forEach((task) => {
        const row = ensureProject(task.project);
        const category = d.categoryById.get(task.category);
        row.months.add(data.month);
        row.planned += toNumber(task.plannedHours);
        row.tasks += 1;
        if (category) row.categories.add(category.label);
        else if (clean(task.category)) row.categories.add(clean(task.category));
        if (clean(task.issue)) row.issues.add(clean(task.issue));
        totalPlanned += toNumber(task.plannedHours);
        totalTasks += 1;
      });
      arrayOrEmpty(data.logs).filter(isPlainObject).forEach((log) => {
        const task = d.tasksById.get(log.taskId);
        const row = ensureProject(task ? task.project : '未归属项目');
        const hours = toNumber(log.hours);
        row.months.add(data.month);
        row.actual += hours;
        row.logs += 1;
        if (task) {
          const category = d.categoryById.get(task.category);
          if (category) row.categories.add(category.label);
          else if (clean(task.category)) row.categories.add(clean(task.category));
          if (clean(task.issue)) row.issues.add(clean(task.issue));
        }
        totalActual += hours;
        totalLogs += 1;
      });
    });

  const rows = Array.from(projects.values())
    .map((row) => Object.assign({}, row, {
      months: Array.from(row.months).sort(),
      categories: Array.from(row.categories).sort((a, b) => a.localeCompare(b)),
      issues: Array.from(row.issues).sort((a, b) => a.localeCompare(b)),
      plannedRatio: totalPlanned > 0 ? (row.planned / totalPlanned) * 100 : 0,
      actualRatio: totalActual > 0 ? (row.actual / totalActual) * 100 : 0
    }))
    .sort((a, b) => b.planned - a.planned || b.actual - a.actual || a.project.localeCompare(b.project));

  return { rows, totalPlanned, totalActual, totalTasks, totalLogs, month: selectedMonth };
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

function buildMonthlyReportContent(data, dataPath, template = DEFAULT_MONTHLY_REPORT_TEMPLATE) {
  const context = buildMonthlyReportContext(data, dataPath);
  const source = typeof template === 'string' && template.trim() ? template : DEFAULT_MONTHLY_REPORT_TEMPLATE;
  return source.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key) => (
    Object.prototype.hasOwnProperty.call(context, key) ? context[key] : ''
  ));
}

function buildMonthlyReportContext(data, dataPath) {
  const source = isPlainObject(data) ? data : defaultData(currentMonth());
  const tasks = arrayOrEmpty(source.tasks).filter(isPlainObject);
  const logs = arrayOrEmpty(source.logs).filter(isPlainObject);
  const d = deriveWorklogData(source);
  const diff = d.totalActual - d.totalPlanned;
  const overviewRows = [
    ['计划工时', `${formatHours(d.totalPlanned)}h`],
    ['实际工时', `${formatHours(d.totalActual)}h`],
    ['差异', `${formatSignedHours(diff)}h`],
    ['完成率', `${completionPercent(d.completedTasks, d.totalTasks)}%`],
    ['任务数', String(d.totalTasks)],
    ['任务类型', `${d.taskCategories.length} 类`],
    ['记录数', String(logs.length)]
  ];
  const statusRows = STATUSES.map((status) => [
    status.label,
    String(d.statusCounts[status.id] || 0)
  ]);
  const categoryRows = taskTypeRowsForData(source, d).map((category) => [
    category.label,
    `${formatHours(category.planned)}h`,
    `${formatHours(category.actual)}h`,
    `${formatSignedHours(category.actual - category.planned)}h`,
    `${category.tasks} 个`
  ]);
  const projectScope = projectRowsForScope([{ data: source, d }], source.month.slice(0, 4), source.month);
  const projectRows = projectScope.rows.map((row) => [
    row.project,
    row.categories.join('、') || '-',
    row.issues.slice(0, 3).join('、') || '-',
    `${formatHours(row.planned)}h`,
    `${formatHours(row.actual)}h`,
    `${row.tasks} 个`
  ]);
  const taskRow = (task) => {
    const category = d.categoryById.get(task.category);
    return [
      task.name,
      task.project || '-',
      category ? category.label : task.category,
      `${formatHours(task.plannedHours)}h`,
      `${formatHours(d.actualByTask.get(task.id) || 0)}h`,
      statusLabel(task.status)
    ];
  };
  const completedTaskRows = tasks.filter((task) => clean(task.status || 'doing') === 'done').map(taskRow);
  const carryTaskRows = tasks
    .filter((task) => !['done', 'cancelled'].includes(clean(task.status || 'doing')))
    .map(taskRow);
  const logRows = logs.map((log) => {
    const task = d.tasksById.get(log.taskId);
    return [
      log.date,
      task ? task.name : '未找到任务',
      `${formatHours(log.hours)}h`,
      log.work,
      log.issueLink || (task ? task.issue : '') || '-'
    ];
  });
  return {
    month: source.month,
    monthTitle: formatMonthTitle(source.month),
    dataPath,
    createdAt: new Date().toISOString(),
    overviewTable: markdownTable(['指标', '数值'], overviewRows),
    statusTable: markdownTable(['状态', '任务数'], statusRows),
    categoryTable: markdownTable(['类型', '计划工时', '实际工时', '差异', '任务数'], categoryRows, '暂无任务类型数据。'),
    projectTable: markdownTable(['项目', '任务类型', '关联 issue', '计划工时', '实际工时', '任务数'], projectRows, '暂无项目数据。'),
    completedTaskTable: markdownTable(['任务', '归属项目', '类型', '计划工时', '实际工时', '状态'], completedTaskRows, '暂无已完成任务。'),
    carryTaskTable: markdownTable(['任务', '归属项目', '类型', '计划工时', '实际工时', '状态'], carryTaskRows, '暂无延续任务。'),
    logTable: markdownTable(['日期', '任务', '工时', '工作内容', 'issue'], logRows, '暂无工时记录。')
  };
}

function buildAnnualReportContent(items, year, dataFolder, template = DEFAULT_ANNUAL_REPORT_TEMPLATE) {
  const context = buildAnnualReportContext(items, year, dataFolder);
  const source = typeof template === 'string' && template.trim() ? template : DEFAULT_ANNUAL_REPORT_TEMPLATE;
  return source.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key) => (
    Object.prototype.hasOwnProperty.call(context, key) ? context[key] : ''
  ));
}

function buildAnnualReportContext(items, year, dataFolder) {
  const targetYear = normalizeYear(year) || currentYear();
  const yearItems = scopedWorklogItems(items, targetYear);
  const summary = yearSummary(yearItems).find((item) => item.year === targetYear) || {
    year: targetYear,
    months: [],
    totalPlanned: 0,
    totalActual: 0,
    totalLogs: 0,
    totalTasks: 0,
    completedTasks: 0,
    statusCounts: taskStatusCounts([]),
    categoryRows: []
  };
  const diff = summary.totalActual - summary.totalPlanned;
  const overviewRows = [
    ['统计月份', `${summary.months.length} 个月`],
    ['计划工时', `${formatHours(summary.totalPlanned)}h`],
    ['实际工时', `${formatHours(summary.totalActual)}h`],
    ['差异', `${formatSignedHours(diff)}h`],
    ['完成率', `${completionPercent(summary.completedTasks, summary.totalTasks)}%`],
    ['任务数', `${summary.totalTasks} 个`],
    ['任务类型', `${summary.categoryRows.length} 类`],
    ['记录数', `${summary.totalLogs} 条`]
  ];
  const statusRows = STATUSES.map((status) => [
    status.label,
    String(summary.statusCounts[status.id] || 0)
  ]);
  const categoryRows = summary.categoryRows.map((category) => [
    category.label,
    `${formatHours(category.planned)}h`,
    `${formatHours(category.actual)}h`,
    `${formatSignedHours(category.actual - category.planned)}h`,
    `${category.tasks} 个`,
    formatPercent(category.plannedRatio)
  ]);
  const projectScope = projectRowsForScope(yearItems, targetYear);
  const projectRows = projectScope.rows.map((row) => [
    row.project,
    row.months.join('、') || '-',
    row.categories.slice(0, 5).join('、') || '-',
    row.issues.slice(0, 5).join('、') || '-',
    `${formatHours(row.planned)}h`,
    `${formatHours(row.actual)}h`,
    `${row.tasks} 个`
  ]);
  const monthRows = summary.months.map((month) => [
    month.month,
    `${formatHours(month.plannedHours)}h`,
    `${formatHours(month.actualHours)}h`,
    `${formatSignedHours(month.actualHours - month.plannedHours)}h`,
    `${month.tasks} 个`,
    `${month.logs} 条`
  ]);
  return {
    year: targetYear,
    dataFolder,
    createdAt: new Date().toISOString(),
    overviewTable: markdownTable(['指标', '数值'], overviewRows),
    statusTable: markdownTable(['状态', '任务数'], statusRows),
    categoryTable: markdownTable(['类型', '计划工时', '实际工时', '差异', '任务数', '计划占比'], categoryRows, '暂无任务类型数据。'),
    projectTable: markdownTable(['项目', '月份', '任务类型', '关联 issue', '计划工时', '实际工时', '任务数'], projectRows, '暂无项目数据。'),
    monthTable: markdownTable(['月份', '计划工时', '实际工时', '差异', '任务数', '记录数'], monthRows, '暂无月度数据。')
  };
}

class WorklogMonthPickerModal extends Modal {
  constructor(app, plugin, options = {}) {
    super(app);
    this.plugin = plugin;
    this.title = options.title || '选择月份';
    this.actionText = options.actionText || '确定';
    this.monthDesc = options.monthDesc || '选择月份';
    this.months = Array.from(new Set(arrayOrEmpty(options.months).filter(isValidMonth))).sort((a, b) => b.localeCompare(a));
    this.year = normalizeYear(options.year) || (this.months[0] ? this.months[0].slice(0, 4) : currentYear());
    this.month = clean(options.month) || (this.months[0] ? this.months[0].slice(5, 7) : currentMonth().slice(5, 7));
  }

  onOpen() {
    const { contentEl } = this;
    this.modalEl.addClass('worklog-modal');
    this.setTitle(this.title);
    contentEl.empty();
    new Setting(contentEl)
      .setName('年份')
      .setDesc('请输入 4 位年份，例如 2026')
      .addText((text) => text
        .setValue(this.year)
        .setPlaceholder('例如 2026')
        .onChange((value) => {
          this.year = clean(value);
          this.refreshMonthOptions(monthSelect);
        }));

    const monthSetting = new Setting(contentEl).setName('月份').setDesc(this.monthDesc);
    const monthSelect = document.createElement('select');
    monthSelect.addEventListener('change', () => { this.month = monthSelect.value; });
    monthSetting.controlEl.appendChild(monthSelect);
    this.refreshMonthOptions(monthSelect);

    new Setting(contentEl).addButton((button) => button
      .setButtonText(this.actionText)
      .setCta()
      .onClick(async () => {
        const month = normalizeMonth(this.year, this.month);
        if (!month) {
          new Notice('请选择有效的年月');
          return;
        }
        await this.onConfirm(month);
      }));
  }

  refreshMonthOptions(select) {
    select.empty();
    monthOptions().forEach((value) => {
      select.appendChild(new Option(this.monthLabel(value), value));
    });
    if (!monthOptions().includes(this.month)) this.month = currentMonth().slice(5, 7);
    select.value = this.month;
  }

  monthLabel(value) {
    return `${Number(value)} 月`;
  }

  async onConfirm() {}
}

class CreateWorklogMonthModal extends WorklogMonthPickerModal {
  constructor(app, plugin) {
    super(app, plugin, {
      title: '创建工时工作台',
      actionText: '创建',
      year: currentYear(),
      month: currentMonth().slice(5, 7),
      monthDesc: '选择要创建的月份'
    });
  }

  async onConfirm(month) {
    this.close();
    await this.plugin.createMonthDashboard(month);
  }
}

class JumpWorklogMonthModal extends WorklogMonthPickerModal {
  constructor(app, plugin, months) {
    const sortedMonths = Array.from(new Set(arrayOrEmpty(months).filter(isValidMonth))).sort((a, b) => b.localeCompare(a));
    super(app, plugin, {
      title: '跳转到月份工时工作台',
      actionText: '打开',
      months: sortedMonths,
      year: sortedMonths[0] ? sortedMonths[0].slice(0, 4) : currentYear(),
      month: sortedMonths[0] ? sortedMonths[0].slice(5, 7) : currentMonth().slice(5, 7),
      monthDesc: '已有数据会直接打开，无数据会询问是否创建'
    });
  }

  monthLabel(value) {
    const targetMonth = normalizeMonth(this.year, value);
    const suffix = this.months.includes(targetMonth) ? '已有数据' : '无数据';
    return `${Number(value)} 月（${suffix}）`;
  }

  async onConfirm(month) {
    if (this.months.includes(month)) {
      this.close();
      await this.plugin.openView(month);
      return;
    }
    if (!confirm(`该月份还没有数据，是否创建 ${month} 的工时工作台？`)) return;
    this.close();
    await this.plugin.createMonthDashboard(month);
  }
}

class JumpWorklogYearModal extends Modal {
  constructor(app, plugin, years) {
    super(app);
    this.plugin = plugin;
    this.existingYears = Array.from(new Set(arrayOrEmpty(years).map(normalizeYear).filter(Boolean))).sort((a, b) => b.localeCompare(a));
    this.year = this.existingYears[0] || currentYear();
  }

  onOpen() {
    const { contentEl } = this;
    this.modalEl.addClass('worklog-modal');
    this.setTitle('跳转到年度工时看板');
    contentEl.empty();
    new Setting(contentEl)
      .setName('年份')
      .setDesc('请输入 4 位年份，例如 2026')
      .addText((text) => text
        .setValue(this.year)
        .setPlaceholder('例如 2026')
        .onChange((value) => { this.year = clean(value); }));
    new Setting(contentEl).addButton((button) => button
      .setButtonText('打开')
      .setCta()
      .onClick(async () => {
        const year = normalizeYear(this.year);
        if (!year) {
          new Notice('请选择有效年份');
          return;
        }
        if (!(await this.plugin.hasYearData(year))) {
          new Notice(`${year} 年暂无工时数据`);
          return;
        }
        this.close();
        await this.plugin.openYearDashboard(year);
      }));
  }
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
    this.addCommand({ id: 'create-worklog-month-dashboard', name: '创建工时工作台', callback: () => new CreateWorklogMonthModal(this.app, this).open() });
    this.addCommand({ id: 'jump-worklog-month', name: '跳转到月份工时工作台', callback: async () => new JumpWorklogMonthModal(this.app, this, await this.dataMonths()).open() });
    this.addCommand({ id: 'jump-worklog-year', name: '跳转到年度工时看板', callback: async () => new JumpWorklogYearModal(this.app, this, await this.availableYears()).open() });
    this.addCommand({ id: 'open-worklog-year-dashboard', name: '打开年度工时看板', callback: () => this.openYearDashboard() });
    this.addSettingTab(new WorklogSettingTab(this.app, this));
    await this.maybeCreateReports();
    if (typeof window !== 'undefined') {
      this.registerInterval(window.setInterval(() => this.maybeCreateReports(), 60 * 60 * 1000));
    }
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(YEAR_VIEW_TYPE);
  }

  configPath() {
    return `${this.manifest.dir}/${CONFIG_FILE_NAME}`;
  }

  defaultDataFolder() {
    return `${this.manifest.dir}/${DATA_FOLDER_NAME}`;
  }

  dataFolder() {
    return normalizeFolderPath(this.settings.dataFolder) || this.defaultDataFolder();
  }

  reportFolder(value = this.settings.worklogFolder) {
    return normalizeFolderPath(value) || DEFAULT_SETTINGS.worklogFolder;
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
    const targetMonth = isValidMonth(month) ? month : currentMonth();
    return `${this.dataFolder()}/${targetMonth.slice(0, 4)}/${targetMonth}.json`;
  }

  monthDataFolder(month) {
    const targetMonth = isValidMonth(month) ? month : currentMonth();
    return `${this.dataFolder()}/${targetMonth.slice(0, 4)}`;
  }

  monthFromDataPath(path) {
    const prefix = escapeRegExp(this.dataFolder());
    const match = clean(path).match(new RegExp(`^${prefix}/(20\\d{2})/(20\\d{2}-\\d{2})\\.json$`));
    if (!match) return '';
    if (match[1] !== match[2].slice(0, 4)) return '';
    return match[2];
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

  reportYearFolder(year) {
    const targetYear = normalizeYear(year) || currentYear();
    return `${this.reportFolder()}/${targetYear}`;
  }

  monthlyReportPath(month) {
    const targetMonth = isValidMonth(month) ? month : currentMonth();
    return `${this.reportYearFolder(targetMonth.slice(0, 4))}/${targetMonth} 月度终结报告.md`;
  }

  annualReportPath(year) {
    const targetYear = normalizeYear(year) || currentYear();
    return `${this.reportYearFolder(targetYear)}/${targetYear} 年度终结报告.md`;
  }

  monthlyReportTemplatePath() {
    return `${this.reportFolder()}/月度终结报告模板.md`;
  }

  annualReportTemplatePath() {
    return `${this.reportFolder()}/年度终结报告模板.md`;
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
    const targetMonth = isValidMonth(month) ? month : currentMonth();
    await this.ensureAdapterFolder(this.monthDataFolder(targetMonth));
    const path = this.dataPath(targetMonth);
    if (await this.app.vault.adapter.exists(path)) {
      try {
        return normalizeData(JSON.parse(await this.app.vault.adapter.read(path)), targetMonth, this.settings);
      } catch (error) {
        console.error(`Worklog: failed to read ${path}`, error);
        new Notice(`工时数据读取失败，请检查 ${path}`);
        return normalizeData({}, targetMonth, this.settings);
      }
    }
    const data = defaultData(targetMonth, this.settings);
    await this.app.vault.adapter.write(path, JSON.stringify(data, null, 2));
    return data;
  }

  async dataFiles() {
    const files = await this.adapterFiles(this.dataFolder());
    return files.filter((path) => this.monthFromDataPath(path)).sort((a, b) => a.localeCompare(b));
  }

  async adapterFiles(folder) {
    const root = clean(folder);
    if (!root || !(await this.app.vault.adapter.exists(root))) return [];
    const result = [];
    const walk = async (dir) => {
      const listed = await this.app.vault.adapter.list(dir);
      listed.files.forEach((path) => result.push(path));
      for (const child of listed.folders) {
        await walk(child);
      }
    };
    await walk(root);
    return result;
  }

  async copyFolderFiles(sourceFolder, targetFolder, filter = () => true) {
    const source = clean(sourceFolder);
    const target = clean(targetFolder);
    const result = { copied: 0, skipped: 0 };
    if (!source || !target || source === target || !(await this.app.vault.adapter.exists(source))) return result;
    const files = (await this.adapterFiles(source)).filter(filter);
    const prefix = source.endsWith('/') ? source : `${source}/`;
    for (const file of files) {
      const relative = file.startsWith(prefix) ? file.slice(prefix.length) : file.split('/').pop();
      const nextPath = `${target}/${relative}`;
      if (await this.app.vault.adapter.exists(nextPath)) {
        result.skipped += 1;
        continue;
      }
      const folder = parentPath(nextPath);
      if (folder) await this.ensureAdapterFolder(folder);
      await this.app.vault.adapter.write(nextPath, await this.app.vault.adapter.read(file));
      result.copied += 1;
    }
    return result;
  }

  async updateDataFolder(nextValue) {
    const previousFolder = this.dataFolder();
    const nextSetting = normalizeFolderPath(nextValue);
    const nextFolder = nextSetting || this.defaultDataFolder();
    const migrated = await this.copyFolderFiles(previousFolder, nextFolder, (path) => path.endsWith('.json'));
    this.settings.dataFolder = nextSetting;
    await this.saveSettings();
    this.refreshOpenViews();
    new Notice(`已保存数据目录，迁移 ${migrated.copied} 个文件${migrated.skipped ? `，跳过 ${migrated.skipped} 个已存在文件` : ''}`);
  }

  async updateReportFolder(nextValue) {
    const previousFolder = this.reportFolder();
    const nextFolder = this.reportFolder(nextValue);
    const migrated = await this.copyFolderFiles(previousFolder, nextFolder, (path) => path.endsWith('.md'));
    this.settings.worklogFolder = nextFolder;
    await this.saveSettings();
    await this.ensureReportTemplates();
    new Notice(`已保存终结报告目录，迁移 ${migrated.copied} 个文件${migrated.skipped ? `，跳过 ${migrated.skipped} 个已存在文件` : ''}`);
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

  async readExistingMonthData(month) {
    const targetMonth = isValidMonth(month) ? month : '';
    if (!targetMonth) return null;
    const path = this.dataPath(targetMonth);
    if (!(await this.app.vault.adapter.exists(path))) return null;
    const data = await this.readExistingData(path);
    if (data) return { data, path };
    return null;
  }

  async readExistingYearData(year) {
    const targetYear = normalizeYear(year);
    if (!targetYear) return [];
    const files = (await this.dataFiles()).filter((path) => this.monthFromDataPath(path).startsWith(`${targetYear}-`));
    const items = await Promise.all(files.map((file) => this.readExistingData(file)));
    return items.filter(Boolean).sort((a, b) => a.month.localeCompare(b.month));
  }

  async readAllExistingData() {
    const files = await this.dataFiles();
    const items = await Promise.all(files.map((file) => this.readExistingData(file)));
    return items.filter(Boolean);
  }

  async writeData(data) {
    const month = isValidMonth(data.month) ? data.month : currentMonth();
    await this.ensureAdapterFolder(this.monthDataFolder(month));
    const path = this.dataPath(month);
    const next = Object.assign({}, data, { updatedAt: new Date().toISOString() });
    await this.app.vault.adapter.write(path, JSON.stringify(next, null, 2));
    this.refreshMonthViews(month);
    this.refreshYearDashboards();
    return next;
  }

  shouldCreateReports() {
    return !!this.settings.createMonthlyReport;
  }

  monthlyReportTargetMonth(date = new Date()) {
    return isFirstDayOfMonth(date) ? previousMonthFromDate(date) : '';
  }

  annualReportTargetYear(date = new Date()) {
    return isFirstDayOfYear(date) ? previousYearFromDate(date) : '';
  }

  async maybeCreateReports(showNotice = false) {
    if (!this.shouldCreateReports()) return { monthly: null, annual: null };
    await this.ensureReportTemplates();
    const month = this.monthlyReportTargetMonth();
    const year = this.annualReportTargetYear();
    const monthly = month ? await this.createMonthlyReport(month, showNotice) : null;
    const annual = year ? await this.createAnnualReport(year, showNotice) : null;
    if (showNotice && !month && !year) new Notice('已开启终结报告；月报会在每月 1 日生成，年报会在每年 1 月 1 日生成。');
    return { monthly, annual };
  }

  async ensureReportTemplates() {
    const monthly = await this.ensureMonthlyReportTemplate();
    const annual = await this.ensureAnnualReportTemplate();
    return { monthly, annual };
  }

  async ensureMonthlyReportTemplate() {
    await this.ensureFolder(this.reportFolder());
    const path = this.monthlyReportTemplatePath();
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file) return file;
    return this.app.vault.create(path, DEFAULT_MONTHLY_REPORT_TEMPLATE);
  }

  async ensureAnnualReportTemplate() {
    await this.ensureFolder(this.reportFolder());
    const path = this.annualReportTemplatePath();
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file) return file;
    return this.app.vault.create(path, DEFAULT_ANNUAL_REPORT_TEMPLATE);
  }

  async createMonthlyReport(month, showNotice = false) {
    const targetMonth = isValidMonth(month) ? month : previousMonthFromDate(new Date());
    await this.ensureFolder(this.reportYearFolder(targetMonth.slice(0, 4)));
    const templateFile = await this.ensureMonthlyReportTemplate();
    const path = this.monthlyReportPath(targetMonth);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing) {
      if (showNotice) new Notice(`${targetMonth} 月度终结报告已存在`);
      return existing;
    }
    const existingData = await this.readExistingMonthData(targetMonth);
    if (!existingData) {
      if (showNotice) new Notice(`${targetMonth} 没有工时数据，未创建月度终结报告`);
      return null;
    }
    let template = DEFAULT_MONTHLY_REPORT_TEMPLATE;
    try {
      template = await this.app.vault.read(templateFile);
    } catch (error) {
      console.error('Worklog: failed to read monthly report template', error);
    }
    const content = buildMonthlyReportContent(existingData.data, existingData.path, template);
    const file = await this.app.vault.create(path, content);
    if (showNotice) new Notice(`已创建 ${targetMonth} 月度终结报告`);
    return file;
  }

  async createAnnualReport(year, showNotice = false) {
    const targetYear = normalizeYear(year) || previousYearFromDate(new Date());
    await this.ensureFolder(this.reportYearFolder(targetYear));
    const templateFile = await this.ensureAnnualReportTemplate();
    const path = this.annualReportPath(targetYear);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing) {
      if (showNotice) new Notice(`${targetYear} 年度终结报告已存在`);
      return existing;
    }
    const yearData = await this.readExistingYearData(targetYear);
    if (!yearData.length) {
      if (showNotice) new Notice(`${targetYear} 年没有工时数据，未创建年度终结报告`);
      return null;
    }
    let template = DEFAULT_ANNUAL_REPORT_TEMPLATE;
    try {
      template = await this.app.vault.read(templateFile);
    } catch (error) {
      console.error('Worklog: failed to read annual report template', error);
    }
    const content = buildAnnualReportContent(yearData, targetYear, this.dataFolder(), template);
    const file = await this.app.vault.create(path, content);
    if (showNotice) new Notice(`已创建 ${targetYear} 年度终结报告`);
    return file;
  }

  async openView(month = currentMonth()) {
    if (!isValidMonth(month)) {
      new Notice(`无效月份：${month}`);
      return;
    }
    await this.readData(month);
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.setViewState({ type: VIEW_TYPE, active: true, state: { month } });
    this.app.workspace.revealLeaf(leaf);
  }

  async createMonthDashboard(month = currentMonth()) {
    if (!isValidMonth(month)) {
      new Notice(`无效月份：${month}`);
      return;
    }
    await this.readData(month);
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.setViewState({ type: VIEW_TYPE, active: true, state: { month } });
    this.app.workspace.revealLeaf(leaf);
    new Notice(`已创建 ${month} 工时工作台`);
  }

  async dataMonths() {
    const files = await this.dataFiles();
    return Array.from(new Set(files.map((path) => this.monthFromDataPath(path)).filter(isValidMonth))).sort((a, b) => b.localeCompare(a));
  }

  async availableYears() {
    const years = new Set();
    const files = await this.dataFiles();
    files.forEach((path) => {
      const month = this.monthFromDataPath(path);
      if (isValidMonth(month)) years.add(month.slice(0, 4));
    });
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }

  async hasYearData(year) {
    const targetYear = normalizeYear(year);
    if (!targetYear) return false;
    const years = await this.availableYears();
    return years.includes(targetYear);
  }

  async openYearDashboard(year = currentYear()) {
    const targetYear = normalizeYear(year) || currentYear();
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.setViewState({ type: YEAR_VIEW_TYPE, active: true, state: { year: targetYear } });
    this.app.workspace.revealLeaf(leaf);
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

  iconButton(text, icon, className, onClick) {
    const button = this.button(text, className, onClick);
    button.prepend(this.el('span', `worklog-button-icon ${icon}`));
    return button;
  }

  actionIconButton(icon, label, className, onClick, disabled = false) {
    const button = this.el('button', `worklog-icon-button ${className || ''}`.trim());
    button.type = 'button';
    button.disabled = disabled;
    setIcon(button, icon);
    button.appendChild(this.el('span', 'worklog-visually-hidden', label));
    button.addEventListener('click', (event) => {
      if (button.disabled) return;
      onClick(event);
    });
    return button;
  }

  pageScrollContainer(node) {
    const viewContent = this.contentEl && this.contentEl.closest ? this.contentEl.closest('.view-content') : null;
    if (viewContent && viewContent !== node) return viewContent;
    if (this.contentEl && this.contentEl !== node) return this.contentEl;
    let parent = node ? node.parentElement : null;
    while (parent) {
      if (typeof window !== 'undefined' && window.getComputedStyle) {
        const overflowY = window.getComputedStyle(parent).overflowY;
        if (/(auto|scroll|overlay)/.test(overflowY)) return parent;
      }
      parent = parent.parentElement;
    }
    return null;
  }

  attachBoundaryWheelScroll(scroller) {
    if (!scroller) return;
    scroller.addEventListener('wheel', (event) => {
      if (event.defaultPrevented || !event.deltaY) return;
      const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const atTop = scroller.scrollTop <= 0;
      const atBottom = scroller.scrollTop >= maxScrollTop - 1;
      const shouldPassToPage = maxScrollTop <= 1 || (event.deltaY < 0 && atTop) || (event.deltaY > 0 && atBottom);
      if (!shouldPassToPage) return;
      const page = this.pageScrollContainer(scroller);
      if (!page || page === scroller) return;
      const scrollDelta = event.deltaMode === 1
        ? event.deltaY * 16
        : (event.deltaMode === 2 ? event.deltaY * page.clientHeight : event.deltaY);
      const before = page.scrollTop;
      page.scrollTop += scrollDelta;
      if (page.scrollTop !== before) event.preventDefault();
    }, { passive: false });
  }

  render() {
    this.contentEl.empty();
    const root = this.contentEl.createDiv({ cls: 'worklog-plugin-view' });
    if (!this.data) {
      root.createEl('div', { text: '加载中...' });
      return;
    }
    const d = this.derived();
    const main = this.el('main', 'worklog-main');
    const header = this.el('div', 'worklog-header');
    const title = this.el('div', 'worklog-title-block');
    title.appendChild(this.el('h2', '', `${formatMonthTitle(this.data.month)}工时工作台`));
    title.appendChild(this.el('p', '', '任务、工时、日历和统计在同一个月度视图里完成。'));
    header.appendChild(title);
    const actions = this.el('div', 'worklog-actions');
    actions.appendChild(this.iconButton('新增任务', 'plus', '', () => new TaskModal(this.app, this).open()));
    actions.appendChild(this.iconButton('新增工时', 'plus', 'primary', () => new LogModal(this.app, this, this.selectedDate).open()));
    actions.appendChild(this.button('选择年月', '', async () => new JumpWorklogMonthModal(this.app, this.plugin, await this.plugin.dataMonths()).open()));
    header.appendChild(actions);
    main.appendChild(header);

    main.appendChild(this.renderDashboard(d));
    const monthGrid = this.el('div', 'worklog-month-grid');
    monthGrid.appendChild(this.renderChartCard(d));
    monthGrid.appendChild(this.renderTasks(d));
    monthGrid.appendChild(this.renderLogs(d));
    monthGrid.appendChild(this.renderCalendar(d));
    main.appendChild(monthGrid);
    root.appendChild(main);
  }

  renderDashboard(d) {
    const section = this.el('section', 'worklog-dashboard');
    const stats = this.el('div', 'worklog-stats');
    stats.appendChild(this.stat('计划工时', `${formatHours(d.totalPlanned)}h`, `本月 ${this.data.tasks.length} 个任务`));
    stats.appendChild(this.stat('实际工时', `${formatHours(d.totalActual)}h`, `已记录 ${this.data.logs.length} 条工时`, 'actual'));
    stats.appendChild(this.stat('完成率', `${completionPercent(d.completedTasks, d.totalTasks)}%`, statusCountText(d.statusCounts), 'good'));
    stats.appendChild(this.stat('任务统计', `${d.totalTasks} 个`, `总任务类型 ${d.taskCategories.length} 类`, 'type'));
    section.appendChild(stats);
    return section;
  }

  stat(label, value, desc = '', tone = '') {
    const item = this.el('div', `worklog-stat ${tone ? `worklog-stat-${tone}` : ''}`.trim());
    item.appendChild(this.el('span', 'label', label));
    item.appendChild(this.el('strong', '', value));
    if (desc) item.appendChild(this.el('small', '', desc));
    return item;
  }

  renderChartCard(d) {
    const section = this.el('section', 'worklog-card worklog-chart-card');
    const head = this.el('div', 'worklog-card-head');
    head.appendChild(this.el('h3', '', '计划 / 实际工时'));
    const legend = this.el('div', 'worklog-chart-legend');
    legend.appendChild(this.legendItem('计划', 'planned'));
    legend.appendChild(this.legendItem('实际', 'actual'));
    head.appendChild(legend);
    section.appendChild(head);
    section.appendChild(this.renderChart(d));
    return section;
  }

  renderChart(d) {
    const rows = taskTypeRowsForData(this.data, d).map((category) => ({ category, planned: category.planned, actual: category.actual }));
    const panel = this.el('div', 'worklog-chart-panel');
    if (!rows.length) {
      panel.appendChild(this.el('div', 'worklog-empty', '暂无任务数据'));
      return panel;
    }
    const max = Math.max(1, ...rows.map((row) => Math.max(row.planned, row.actual)));
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
    groups.style.setProperty('--worklog-chart-columns', String(rows.length));
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
    tooltip.appendChild(this.tooltipRow('占比', 'planned', formatPercent(row.category.plannedRatio)));
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
    const section = this.el('section', 'worklog-card worklog-calendar-card');
    const head = this.el('div', 'worklog-card-head');
    head.appendChild(this.el('h3', '', `${formatMonthTitle(this.data.month)}日历`));
    head.appendChild(this.el('span', 'worklog-badge', `${(this.data.dailyStatus.completedDates || []).length} 天`));
    section.appendChild(head);
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
      if (cell.count) {
        const hours = this.el('span', 'day-hours', `工时合计 ${formatHours(cell.hours)}h`);
        hours.id = `worklog-day-hours-${cell.date}`;
        day.setAttribute('aria-describedby', hours.id);
        day.appendChild(hours);
      }
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
    const section = this.el('section', 'worklog-card worklog-task-card');
    const head = this.el('div', 'worklog-card-head');
    head.appendChild(this.el('h3', '', '任务清单'));
    head.appendChild(this.el('span', 'worklog-badge', `${this.data.tasks.length} 个任务`));
    section.appendChild(head);
    const list = this.el('div', 'worklog-task-list');
    this.data.tasks.forEach((task, index) => {
      const category = d.categoryById.get(task.category);
      const row = this.el('div', `worklog-task-item ${statusClass(task.status)}`);
      row.style.setProperty('--worklog-task-color', categoryColorForData(category, index));
      row.appendChild(this.el('span', 'worklog-task-dot'));
      const main = this.el('div', 'worklog-task-main');
      main.appendChild(this.el('strong', '', task.name));
      const metaParts = [
        task.project ? `项目：${task.project}` : '',
        category ? category.label : task.category
      ].filter(Boolean);
      const meta = this.el('span', '', metaParts.join(' · '));
      main.appendChild(meta);
      row.appendChild(main);
      const actualHours = d.actualByTask.get(task.id) || 0;
      const remainingHours = toNumber(task.plannedHours) - toNumber(actualHours);
      const remainingText = formatRemainingHours(remainingHours);
      const hours = this.el('span', 'worklog-task-hours', `${remainingText}h`);
      const hoursTooltip = this.el('span', 'worklog-task-hours-tooltip', `计划工时${formatHours(task.plannedHours)}h-实际总工时${formatHours(actualHours)}h`);
      const hoursTooltipId = `worklog-task-hours-${clean(task.id).replace(/[^a-z0-9_-]/gi, '-') || index}`;
      hoursTooltip.id = hoursTooltipId;
      hours.tabIndex = 0;
      hours.appendChild(hoursTooltip);
      hours.setAttribute('aria-describedby', hoursTooltipId);
      row.appendChild(hours);
      const select = document.createElement('select');
      select.className = 'worklog-status-select';
      STATUSES.forEach((status) => select.appendChild(new Option(status.label, status.id)));
      select.value = task.status;
      select.addEventListener('change', async () => {
        const tasks = this.data.tasks.slice();
        tasks[index] = Object.assign({}, task, { status: select.value });
        await this.save(Object.assign({}, this.data, { tasks }));
      });
      row.appendChild(select);
      const refs = d.logCountByTask.get(task.id) || 0;
      const actions = this.el('div', 'worklog-row-actions worklog-task-actions');
      actions.appendChild(this.actionIconButton('pencil', '编辑任务', 'subtle', () => {
        new TaskModal(this.app, this, task, index).open();
      }));
      actions.appendChild(this.actionIconButton('trash-2', refs > 0 ? '已有工时记录，不能删除' : '删除任务', 'danger subtle', async () => {
        await this.save(Object.assign({}, this.data, {
          tasks: this.data.tasks.filter((_, i) => i !== index),
          logs: this.data.logs.filter((log) => log.taskId !== task.id)
        }));
      }, refs > 0));
      row.appendChild(actions);
      list.appendChild(row);
    });
    if (!this.data.tasks.length) list.appendChild(this.el('div', 'worklog-empty worklog-empty-compact', '暂无任务'));
    this.attachBoundaryWheelScroll(list);
    section.appendChild(list);
    return section;
  }

  renderLogs(d) {
    const section = this.el('section', 'worklog-card worklog-log-card');
    const title = this.selectedDate ? `每日工时明细：${this.selectedDate}` : '每日工时明细';
    const head = this.el('div', 'worklog-card-head');
    head.appendChild(this.el('h3', '', title));
    head.appendChild(this.el('span', 'worklog-badge', 'JSON 本地保存'));
    section.appendChild(head);
    const tableWrap = this.el('div', 'worklog-table-scroll');
    const table = this.el('table', 'worklog-table worklog-log-table');
    table.innerHTML = '<thead><tr><th>日期</th><th>任务</th><th>工时</th><th>工作内容</th><th>issue</th><th>操作</th></tr></thead>';
    const body = this.el('tbody');
    const rows = this.data.logs
      .map((log, index) => ({ log, index }))
      .filter(({ log }) => !this.selectedDate || log.date === this.selectedDate);
    rows.forEach(({ log, index }) => {
      const task = d.tasksById.get(log.taskId);
      const tr = this.el('tr');
      tr.appendChild(this.td(log.date));
      tr.appendChild(this.td(task ? task.name : '未找到任务'));
      tr.appendChild(this.td(`${formatHours(log.hours)}h`));
      tr.appendChild(this.td(log.work));
      tr.appendChild(this.td(log.issueLink || (task ? task.issue : '') || '-'));
      const actionTd = this.el('td', 'worklog-table-actions-cell');
      const actions = this.el('div', 'worklog-row-actions');
      actions.appendChild(this.actionIconButton('pencil', '编辑工时记录', 'subtle', () => {
        new LogModal(this.app, this, log.date, log).open();
      }));
      actions.appendChild(this.actionIconButton('trash-2', '删除工时记录', 'danger subtle', async () => {
        if (!confirm('删除这条工时记录？')) return;
        await this.save(Object.assign({}, this.data, { logs: this.data.logs.filter((_, i) => i !== index) }));
      }));
      actionTd.appendChild(actions);
      tr.appendChild(actionTd);
      body.appendChild(tr);
    });
    table.appendChild(body);
    tableWrap.appendChild(table);
    this.attachBoundaryWheelScroll(tableWrap);
    section.appendChild(tableWrap);
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
    this.selectedYear = currentMonth().slice(0, 4);
    this.projectScopeMonth = '';
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

  async setState(state, result) {
    await super.setState(state, result);
    const year = clean(state && state.year);
    const projectScopeMonth = clean(state && state.projectScopeMonth);
    this.selectedYear = /^(20\d{2})$/.test(year) ? year : currentMonth().slice(0, 4);
    this.projectScopeMonth = isValidMonth(projectScopeMonth) && projectScopeMonth.startsWith(`${this.selectedYear}-`) ? projectScopeMonth : '';
    await this.load();
  }

  getState() {
    return Object.assign({}, super.getState(), { year: this.selectedYear, projectScopeMonth: this.projectScopeMonth });
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

  td(text, className = '') {
    return this.el('td', className, text);
  }

  render() {
    this.contentEl.empty();
    const root = this.contentEl.createDiv({ cls: 'worklog-plugin-view worklog-year-view' });
    const summaries = yearSummary(this.data);
    const summaryYears = summaries.map((summary) => summary.year);
    if (summaryYears.length && !summaryYears.includes(this.selectedYear)) {
      this.selectedYear = summaryYears[0];
      this.projectScopeMonth = '';
    }
    const visibleSummary = summaries.find((summary) => summary.year === this.selectedYear) || null;
    const titleText = this.selectedYear ? `${this.selectedYear} 年度工时看板` : '年度工时看板';
    const visibleSummaries = visibleSummary ? [visibleSummary] : [];

    const main = this.el('main', 'worklog-main');
    const header = this.el('div', 'worklog-header');
    const title = this.el('div', 'worklog-title-block');
    title.appendChild(this.el('h2', '', titleText));
    title.appendChild(this.el('p', '', '自动汇总全年 JSON 数据，查看计划、实际和任务类型占比。'));
    header.appendChild(title);
    const actions = this.el('div', 'worklog-actions');
    actions.appendChild(this.button('刷新', '', () => this.load()));
    actions.appendChild(this.button('选择年度', '', async () => new JumpWorklogYearModal(this.app, this.plugin, await this.plugin.availableYears()).open()));
    header.appendChild(actions);
    main.appendChild(header);

    if (!visibleSummaries.length) {
      main.appendChild(this.el('div', 'worklog-empty', `暂无 ${this.selectedYear} 年度数据`));
      root.appendChild(main);
      return;
    }

    visibleSummaries.forEach((summary) => main.appendChild(this.renderYear(summary)));
    root.appendChild(main);
  }

  renderYear(summary) {
    const section = this.el('section', 'worklog-year-section');
    section.appendChild(this.renderSummaryStats(summary));
    const body = this.el('div', 'worklog-year-body');
    body.appendChild(this.renderMonthlyLineChart(summary));
    body.appendChild(this.renderTaskTypePie(summary));
    section.appendChild(body);
    section.appendChild(this.renderProjectStats(summary));
    section.appendChild(this.renderMonthCards(summary));
    return section;
  }

  renderSummaryStats(summary) {
    const panel = this.el('div', 'worklog-dashboard');
    const stats = this.el('div', 'worklog-stats');
    stats.appendChild(this.summaryStat('计划工时', `${formatHours(summary.totalPlanned)}h`, `汇总 ${summary.months.length} 个月`));
    stats.appendChild(this.summaryStat('实际工时', `${formatHours(summary.totalActual)}h`, `记录 ${summary.totalLogs} 条`, 'actual'));
    stats.appendChild(this.summaryStat('完成率', `${completionPercent(summary.completedTasks, summary.totalTasks)}%`, statusCountText(summary.statusCounts), 'good'));
    stats.appendChild(this.summaryStat('任务统计', `${summary.totalTasks} 个`, `总任务类型 ${summary.categoryRows.length} 类`, 'type'));
    panel.appendChild(stats);
    return panel;
  }

  renderTaskTypePie(summary) {
    const panel = this.el('div', 'worklog-card worklog-pie-panel');
    const head = this.el('div', 'worklog-card-head');
    head.appendChild(this.el('h3', '', '任务类型占比'));
    head.appendChild(this.el('span', 'worklog-badge', `${summary.months.length} 个月`));
    panel.appendChild(head);
    if (!summary.categoryRows.length || summary.totalPlanned <= 0) {
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
    const activeRows = summary.categoryRows.filter((category) => category.planned > 0);
    let angle = -90;
    activeRows.forEach((category, rowIndex) => {
      const index = summary.categoryRows.indexOf(category);
      const color = categoryColorForData(category, index);
      const ratio = category.planned / summary.totalPlanned;
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
      slice.setAttribute('aria-label', `${category.label}：计划 ${formatHours(category.planned)} 小时，${formatPercent(category.plannedRatio)}`);
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
    const prev = this.el('button', 'worklog-pie-legend-arrow', '‹');
    const next = this.el('button', 'worklog-pie-legend-arrow', '›');
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
    tooltip.appendChild(this.tooltipMetricRow(category.label, `${formatHours(category.planned)}h`, color));
    tooltip.appendChild(this.tooltipMetricRow('占比', formatPercent(category.plannedRatio), color, true));
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

  summaryStat(label, value, desc = '', tone = '') {
    const item = this.el('div', `worklog-stat ${tone ? `worklog-stat-${tone}` : ''}`.trim());
    item.appendChild(this.el('span', 'label', label));
    item.appendChild(this.el('strong', '', value));
    if (desc) item.appendChild(this.el('small', '', desc));
    return item;
  }

  renderProjectStats(summary) {
    if (this.projectScopeMonth && !summary.months.some((month) => month.month === this.projectScopeMonth)) {
      this.projectScopeMonth = '';
    }
    const scope = projectRowsForScope(this.data, summary.year, this.projectScopeMonth);
    const panel = this.el('section', 'worklog-card worklog-project-panel');
    const head = this.el('div', 'worklog-card-head worklog-project-head');
    const titleWrap = this.el('div', 'worklog-project-title');
    titleWrap.appendChild(this.el('h3', '', '项目统计'));
    titleWrap.appendChild(this.el('span', 'worklog-badge', scope.month ? `${Number(scope.month.slice(5, 7))} 月` : '全年'));
    head.appendChild(titleWrap);
    const controls = this.el('div', 'worklog-project-controls');
    const select = this.el('select', 'worklog-project-scope-select');
    select.appendChild(new Option('全年', ''));
    summary.months.forEach((month) => select.appendChild(new Option(`${Number(month.month.slice(5, 7))} 月`, month.month)));
    select.value = this.projectScopeMonth;
    select.setAttribute('aria-label', '项目统计筛选月份');
    select.addEventListener('change', () => {
      this.projectScopeMonth = select.value;
      this.render();
    });
    controls.appendChild(select);
    head.appendChild(controls);
    panel.appendChild(head);

    const stats = this.el('div', 'worklog-project-summary');
    stats.appendChild(this.projectSummaryItem('项目', `${scope.rows.length} 个`));
    stats.appendChild(this.projectSummaryItem('计划', `${formatHours(scope.totalPlanned)}h`));
    stats.appendChild(this.projectSummaryItem('实际', `${formatHours(scope.totalActual)}h`));
    stats.appendChild(this.projectSummaryItem('任务', `${scope.totalTasks} 个`));
    panel.appendChild(stats);

    const tableWrap = this.el('div', 'worklog-project-table-wrap');
    const table = this.el('table', 'worklog-table worklog-project-table');
    table.innerHTML = '<thead><tr><th>#</th><th>项目名称</th><th>项目类型</th><th>关联 issue</th><th>计划</th><th>实际</th><th>占比</th><th>任务</th></tr></thead>';
    const body = this.el('tbody');
    scope.rows.forEach((row, index) => {
      const tr = this.el('tr');
      tr.appendChild(this.td(String(index + 1), 'worklog-project-index'));
      const nameCell = this.td('', 'worklog-project-name-cell');
      const nameWrap = this.el('div', 'worklog-project-name-text');
      const name = this.el('strong', '', row.project);
      const meta = this.el('span', '', row.months.length > 1 ? `${row.months.length} 个月` : (row.months[0] || '-'));
      nameWrap.appendChild(name);
      nameWrap.appendChild(meta);
      nameCell.appendChild(nameWrap);
      tr.appendChild(nameCell);
      tr.appendChild(this.td(row.categories.length ? row.categories.slice(0, 3).join('、') : '-'));
      tr.appendChild(this.td(row.issues.length ? row.issues.slice(0, 3).join('、') : '-'));
      tr.appendChild(this.td(`${formatHours(row.planned)}h`, 'worklog-number-cell'));
      tr.appendChild(this.td(`${formatHours(row.actual)}h`, 'worklog-number-cell'));
      const ratioCell = this.td('', 'worklog-project-ratio-cell');
      ratioCell.appendChild(this.el('span', '', formatPercent(row.plannedRatio)));
      const bar = this.el('i', 'worklog-project-ratio-bar');
      bar.style.width = `${Math.max(4, Math.min(100, row.plannedRatio))}%`;
      ratioCell.appendChild(bar);
      tr.appendChild(ratioCell);
      tr.appendChild(this.td(`${row.tasks} 个`, 'worklog-number-cell'));
      body.appendChild(tr);
    });
    if (!scope.rows.length) {
      const emptyRow = this.el('tr');
      const cell = this.td('暂无项目统计数据', 'worklog-project-empty-cell');
      cell.colSpan = 8;
      emptyRow.appendChild(cell);
      body.appendChild(emptyRow);
    }
    table.appendChild(body);
    tableWrap.appendChild(table);
    panel.appendChild(tableWrap);
    return panel;
  }

  projectSummaryItem(label, value) {
    const item = this.el('div', 'worklog-project-summary-item');
    item.appendChild(this.el('span', '', label));
    item.appendChild(this.el('strong', '', value));
    return item;
  }

  renderMonthlyLineChart(summary) {
    const panel = this.el('div', 'worklog-card worklog-line-panel');
    const head = this.el('div', 'worklog-card-head');
    head.appendChild(this.el('h3', '', '月度趋势'));
    const legendHead = this.el('div', 'worklog-chart-legend');
    legendHead.appendChild(this.legendItem('计划', '#64748b'));
    legendHead.appendChild(this.legendItem('实际', '#2563eb'));
    head.appendChild(legendHead);
    panel.appendChild(head);
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
    const pad = { left: 52, right: 24, top: 40, bottom: 56 };
    const xLabelY = height - 50;
    const x = (index) => pad.left + (index / 11) * (width - pad.left - pad.right);
    const y = (value) => pad.top + (1 - value / max) * (height - pad.top - pad.bottom);
    const pointsFor = (key) => months.map((month, index) => ({ x: x(index), y: y(month[key]), value: month[key], month: month.month }));
    const planned = pointsFor('plannedHours');
    const actual = pointsFor('actualHours');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'worklog-line-chart');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('preserveAspectRatio', 'none');
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
      const label = this.svgEl('text', { x: x(index), y: xLabelY, class: 'worklog-line-x-label', 'text-anchor': 'end', transform: `rotate(-45 ${x(index)} ${xLabelY})` });
      label.textContent = month.month;
      svg.appendChild(label);
    });
    this.renderLinePoints(svg, planned, 'planned');
    this.renderLinePoints(svg, actual, 'actual');
    svg.appendChild(targetLayer);
    visual.appendChild(svg);
    visual.appendChild(tooltip);
    panel.appendChild(visual);
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
    tooltip.appendChild(this.tooltipMetricRow('实际工时', `${formatHours(month.actualHours)}h`, '#2563eb'));
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
    const item = this.el('span', 'worklog-chart-legend-item');
    const swatch = this.el('span', 'worklog-chart-swatch custom');
    swatch.style.background = color;
    item.appendChild(swatch);
    item.appendChild(document.createTextNode(label));
    return item;
  }

  renderMonthCards(summary) {
    const wrap = this.el('div', 'worklog-month-cards');
    const byMonth = new Map(summary.months.map((month) => [month.month, month]));
    Array.from({ length: 12 }, (_, index) => {
      const monthId = `${summary.year}-${pad2(index + 1)}`;
      return byMonth.get(monthId) || {
        month: monthId,
        plannedHours: 0,
        actualHours: 0,
        logs: 0,
        tasks: 0
      };
    }).forEach((month) => {
      const hasData = month.tasks > 0 || month.logs > 0 || month.plannedHours > 0 || month.actualHours > 0;
      const card = this.el('div', 'worklog-month-card');
      if (!hasData) card.classList.add('is-empty');
      const monthName = `${Number(month.month.slice(5, 7))} 月`;
      card.appendChild(this.el('strong', '', monthName));
      card.appendChild(this.el('span', `worklog-badge ${hasData ? '' : 'muted'}`.trim(), hasData ? `${formatHours(month.actualHours)}h` : '暂无数据'));
      const preview = this.el('div', 'worklog-mini-bars');
      if (hasData) {
        const planned = Math.max(1, month.plannedHours);
        const actual = Math.max(0, month.actualHours);
        preview.appendChild(this.miniBar('blue', Math.min(100, (actual / planned) * 88)));
        preview.appendChild(this.miniBar('teal', Math.min(86, 42 + (month.logs || 0) * 3)));
        preview.appendChild(this.miniBar('amber', Math.min(82, 45 + (month.tasks || 0) * 5)));
        preview.appendChild(this.miniBar('muted', 52));
      } else {
        preview.appendChild(this.miniBar('muted', 22));
        preview.appendChild(this.miniBar('muted', 36));
        preview.appendChild(this.miniBar('muted', 28));
        preview.appendChild(this.miniBar('muted', 18));
      }
      card.appendChild(preview);
      wrap.appendChild(card);
    });
    return wrap;
  }

  miniBar(className, width) {
    const bar = this.el('i', className);
    bar.style.width = `${Math.max(8, Math.min(100, width))}%`;
    return bar;
  }

  svgEl(tag, attrs) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
    return node;
  }
}

class TaskModal extends Modal {
  constructor(app, view, editingTask = null, taskIndex = -1) {
    super(app);
    this.view = view;
    this.editingTask = editingTask;
    this.taskIndex = taskIndex;
  }

  onOpen() {
    this.modalEl.addClass('worklog-modal');
    const editing = !!this.editingTask;
    this.setTitle(editing ? '编辑任务' : '新增任务');
    const form = this.contentEl;
    const taskTypes = categoriesForData(this.view.data);
    const categoryOptions = taskTypes.filter((item) => item.enabled !== false || (editing && item.id === this.editingTask.category));
    const name = this.addInput('任务名称', this.editingTask?.name || '');
    const project = this.addInput('归属项目', this.editingTask?.project || '');
    const category = this.addSelect('任务类型', categoryOptions, this.editingTask?.category || '');
    const planned = this.addInput('计划工时', editing ? String(this.editingTask.plannedHours || '') : '8', 'number');
    const issue = this.addInput('关联 issue', this.editingTask?.issue || '');
    new Setting(form)
      .addButton((button) => button.setButtonText('取消').onClick(() => this.close()))
      .addButton((button) => button.setButtonText(editing ? '保存修改' : '保存任务').setCta().onClick(async () => {
      if (!clean(name.value)) return new Notice('任务名称不能为空');
      if (!clean(issue.value)) return new Notice('关联 issue 不能为空');
      if (!category.value) return new Notice('请先在插件设置中启用至少一个任务类型');
      const patch = { name: clean(name.value), project: clean(project.value), category: category.value, issue: clean(issue.value), plannedHours: toNumber(planned.value) };
      if (patch.plannedHours <= 0) return new Notice('计划工时必须大于 0');
      if (editing) {
        const tasks = this.view.data.tasks.slice();
        const fallbackIndex = this.taskIndex >= 0 ? this.taskIndex : -1;
        const taskIndex = tasks.findIndex((item) => item.id === this.editingTask.id);
        const updateIndex = taskIndex >= 0 ? taskIndex : fallbackIndex;
        if (updateIndex < 0 || !tasks[updateIndex]) return new Notice('未找到要编辑的任务');
        const task = Object.assign({}, tasks[updateIndex], patch);
        tasks[updateIndex] = task;
        await this.view.save(Object.assign({}, this.view.data, { tasks }));
        new Notice(`已更新任务：${task.name}`);
      } else {
        const taskId = nextTaskId(this.view.data.tasks, this.view.data.month, `${this.view.data.month}-01`);
        const task = Object.assign({ id: taskId, status: 'doing' }, patch);
        await this.view.save(Object.assign({}, this.view.data, { tasks: this.view.data.tasks.concat(task) }));
        new Notice(`已新增任务：${task.name}`);
      }
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

  addSelect(label, options, value = '') {
    let select;
    new Setting(this.contentEl).setName(label).addDropdown((dropdown) => {
      options.forEach((option) => dropdown.addOption(option.id, option.label));
      if (value && options.some((option) => option.id === value)) dropdown.setValue(value);
      select = dropdown.selectEl;
    });
    return select;
  }
}

class LogModal extends Modal {
  constructor(app, view, selectedDate, editingLog = null) {
    super(app);
    this.view = view;
    this.editingLog = editingLog;
    const today = todayIso();
    this.selectedDate = selectedDate || editingLog?.date || (today.startsWith(view.data.month) ? today : `${view.data.month}-01`);
  }

  onOpen() {
    this.modalEl.addClass('worklog-modal');
    this.modalEl.addClass('worklog-log-modal');
    const editing = !!this.editingLog;
    this.setTitle(editing ? '编辑工时' : '新增工时');
    addModalTitleBadge(this.modalEl, this.selectedDate);
    const date = this.addInput('日期', this.editingLog?.date || this.selectedDate, 'date');
    date.min = `${this.view.data.month}-01`;
    date.max = lastDateOfMonth(this.view.data.month);
    const hours = this.addInput('工时', editing ? String(this.editingLog.hours || '') : '1', 'number');
    const taskSelect = this.addTaskSelect(this.editingLog?.taskId || '');
    const work = this.addTextArea('工作内容', this.editingLog?.work || '');
    const selectedTask = this.view.data.tasks.find((item) => item.id === taskSelect.value);
    const displayIssue = this.editingLog ? (this.editingLog.issueLink || (selectedTask ? selectedTask.issue : '')) : '';
    const issue = this.addInput('关联 issue', displayIssue);
    const syncIssueFromTask = () => {
      const task = this.view.data.tasks.find((item) => item.id === taskSelect.value);
      if (task && !clean(issue.value)) issue.value = clean(task.issue);
    };
    taskSelect.addEventListener('change', syncIssueFromTask);
    if (!editing) syncIssueFromTask();
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText('取消').onClick(() => this.close()))
      .addButton((button) => button.setButtonText(editing ? '保存修改' : '保存工时').setCta().onClick(async () => {
      const task = this.view.data.tasks.find((item) => item.id === taskSelect.value);
      if (!task) return new Notice('请选择任务');
      const logDate = normalizeDate(date.value, this.view.data.month);
      if (!logDate) return new Notice(`日期必须是 ${this.view.data.month} 内的有效日期`);
      if (hasLogForTaskDate(this.view.data.logs, task.id, logDate, this.editingLog?.id || '')) return new Notice(`当天已登记过该任务：${task.name}`);
      const category = categoriesForData(this.view.data).find((item) => item.id === task.category);
      if (category && category.requiresLogIssue && !clean(issue.value)) return new Notice('该任务类型必须填写关联 issue');
      if (!clean(work.value)) return new Notice('工作内容不能为空');
      const log = {
        id: this.editingLog?.id || `log-${Date.now().toString(36)}`,
        date: logDate,
        taskId: task.id,
        hours: toNumber(hours.value),
        work: clean(work.value),
        issueLink: clean(issue.value)
      };
      if (log.hours <= 0) return new Notice('工时必须大于 0');
      const logs = editing
        ? this.view.data.logs.map((item) => item.id === log.id ? log : item)
        : this.view.data.logs.concat(log);
      await this.view.save(Object.assign({}, this.view.data, { logs }));
      new Notice(editing ? '已更新工时记录' : `已登记 ${formatHours(log.hours)}h`);
      this.close();
    }));
  }

  addTaskSelect(value = '') {
    let select;
    new Setting(this.contentEl).setName('任务').addDropdown((dropdown) => {
      this.view.data.tasks.forEach((task) => dropdown.addOption(task.id, `${task.name}${task.project ? ` · ${task.project}` : ''}`));
      select = dropdown.selectEl;
      select.value = value || select.value;
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

  addTextArea(label, value = '') {
    let input;
    new Setting(this.contentEl).setName(label).addTextArea((text) => {
      input = text.inputEl;
      input.value = value;
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
    containerEl.addClass('worklog-settings-tab');
    const root = containerEl.createDiv({ cls: 'worklog-plugin-view worklog-settings-view' });
    const shell = root.createEl('main', { cls: 'worklog-main worklog-settings-shell' });
    const header = shell.createDiv({ cls: 'worklog-settings-header' });
    const title = header.createDiv({ cls: 'worklog-title-block' });
    title.createEl('h2', { text: 'Worklog 插件设置' });
    title.createEl('p', { text: '任务类型、默认任务模板、数据目录和终结报告都可以在这里维护。' });
    const headerActions = header.createDiv({ cls: 'worklog-settings-actions' });
    const addTypeButton = headerActions.createEl('button', { cls: 'worklog-button primary', text: '新增任务类型' });
    addTypeButton.addEventListener('click', async () => {
      const next = this.plugin.settings.taskTypes.slice();
      next.push({ id: makeId('type'), label: '新任务类型', color: categoryColor('', next.length), enabled: true, requiresLogIssue: false, sort: next.length });
      this.plugin.settings.taskTypes = normalizeTaskTypes(next);
      await this.plugin.saveSettings();
      this.display();
    });
    const addTemplateButton = headerActions.createEl('button', { cls: 'worklog-button', text: '新增默认模板' });
    addTemplateButton.addEventListener('click', async () => this.addTaskTemplate());

    const typePanel = shell.createDiv({ cls: 'worklog-settings-panel' });
    typePanel.createEl('h3', { text: '任务类型' });
    typePanel.createEl('p', {
      cls: 'setting-item-description',
      text: '停用后不会出现在新建任务下拉框中，也不会参与新月份默认任务生成；历史任务和统计仍会按原类型显示。'
    });
    this.renderTaskTypeHeader(typePanel);
    this.renderTaskTypes(typePanel);

    const templatePanel = shell.createDiv({ cls: 'worklog-settings-panel' });
    templatePanel.createEl('h3', { text: '新月份默认任务模板' });
    templatePanel.createEl('p', {
      cls: 'setting-item-description',
      text: '用于创建新月份时自动生成任务；停用模板不会影响已经创建出来的历史任务。'
    });
    this.renderTemplateHeader(templatePanel);
    this.renderTaskTemplates(templatePanel);

    const configGrid = shell.createDiv({ cls: 'worklog-settings-config-grid' });
    const syncPanel = configGrid.createDiv({ cls: 'worklog-settings-panel worklog-settings-config-panel' });
    syncPanel.createEl('h3', { text: '终结报告' });
    new Setting(syncPanel)
      .setName('自动创建月度 / 年度总结')
      .setDesc('开启后会创建“月度终结报告模板.md”和“年度终结报告模板.md”；每月 1 日读取上个月数据生成月度总结，每年 1 月 1 日读取上一年度数据生成年度总结。')
      .addToggle((toggle) => toggle.setValue(!!this.plugin.settings.createMonthlyReport).onChange(async (value) => {
        this.plugin.settings.createMonthlyReport = value;
        await this.plugin.saveSettings();
        if (value) {
          await this.plugin.ensureReportTemplates();
          await this.plugin.maybeCreateReports(true);
        } else {
          new Notice('已关闭终结报告自动创建');
        }
      }));
    let reportFolderValue = this.plugin.settings.worklogFolder;
    new Setting(syncPanel)
      .setClass('worklog-path-setting')
      .setName('终结报告目录')
      .setDesc('修改后点击“保存并迁移”，会把原目录中的报告和模板复制到新目录；原目录文件会保留。')
      .addText((text) => text.setValue(reportFolderValue).onChange((value) => {
        reportFolderValue = normalizeFolderPath(value) || DEFAULT_SETTINGS.worklogFolder;
      }))
      .addButton((button) => button
        .setButtonText('保存并迁移')
        .onClick(async () => {
          await this.plugin.updateReportFolder(reportFolderValue);
          this.display();
        }));
    const dataPanel = configGrid.createDiv({ cls: 'worklog-settings-panel worklog-settings-config-panel' });
    dataPanel.createEl('h3', { text: '数据目录' });
    let dataFolderValue = this.plugin.settings.dataFolder;
    new Setting(dataPanel)
      .setClass('worklog-path-setting')
      .setName('保存位置')
      .setDesc(`留空时默认保存到 ${this.plugin.defaultDataFolder()}；修改后点击“保存并迁移”，会把原目录中的 JSON 数据复制到新目录，原目录文件会保留。`)
      .addText((text) => text.setPlaceholder(this.plugin.defaultDataFolder()).setValue(dataFolderValue).onChange((value) => {
        dataFolderValue = normalizeFolderPath(value);
      }))
      .addButton((button) => button
        .setButtonText('保存并迁移')
        .onClick(async () => {
          await this.plugin.updateDataFolder(dataFolderValue);
          this.display();
        }));
  }

  async addTaskTemplate() {
    const taskTypes = normalizeTaskTypes(this.plugin.settings.taskTypes);
    if (!taskTypes.length) {
      new Notice('请先新增任务类型，再新增默认任务模板');
      return;
    }
    const next = this.plugin.settings.defaultTaskTemplates.slice();
    next.push({
      id: makeId('tpl'),
      name: '新默认任务',
      project: '',
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
  }

  iconButton(button, icon, label, extraClass = '') {
    if (typeof button.setIcon === 'function') button.setIcon(icon);
    else button.setButtonText(label);
    button.buttonEl.removeAttribute('aria-label');
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
    ['任务名称', '归属项目', '任务类型', '计划工时', '启用', '删除'].forEach((label) => {
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
      setting.addText((text) => text.setPlaceholder('归属项目').setValue(template.project || '').onChange(async (value) => {
        await this.updateTaskTemplate(template.id, { project: clean(value) });
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
