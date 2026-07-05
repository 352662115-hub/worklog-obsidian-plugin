jest.mock('obsidian');

const WorklogPlugin = require('../main');

const {
  WORKLOG_SCHEMA_VERSION,
  defaultData,
  normalizeData,
  migrateData,
  deriveWorklogData,
  buildMonthlyReportContent,
  buildAnnualReportContent,
  isValidDate,
  normalizeDate
} = WorklogPlugin.__test__;

const settings = {
  taskTypes: [
    { id: 'feature', label: '开发', color: '#2563eb', enabled: true, requiresLogIssue: false, sort: 0 },
    { id: 'support', label: '支持', color: '#16a34a', enabled: true, requiresLogIssue: true, sort: 1 }
  ],
  defaultTaskTemplates: []
};

function sampleData() {
  return normalizeData({
    month: '2026-07',
    tasks: [
      { id: 'T1', name: '任务 A', project: '项目甲', category: 'feature', issue: '#1', plannedHours: 8, status: 'done' },
      { id: 'T2', name: '任务 B', project: '项目乙', category: 'support', issue: '#2', plannedHours: '4.5', status: 'doing' }
    ],
    logs: [
      { id: 'L1', date: '2026-07-01', taskId: 'T1', hours: '2.5', work: '实现 A|B', issueLink: '#1' },
      { id: 'L2', date: '2026-07-02T10:30:00+08:00', taskId: 'T2', hours: 3, work: '支持排查', issue: '#2' }
    ],
    dailyStatus: { completedDates: ['2026-07-01', '2026-08-01', 'bad'] }
  }, '2026-07', settings);
}

describe('date validation', () => {
  test('rejects impossible dates and dates outside the target month', () => {
    expect(isValidDate('2026-02-29')).toBe(false);
    expect(isValidDate('2024-02-29')).toBe(true);
    expect(normalizeDate('2026-07-02T10:30:00+08:00', '2026-07')).toBe('2026-07-02');
    expect(normalizeDate('2026-08-01', '2026-07')).toBe('');
  });
});

describe('normalizeData and migration', () => {
  test('normalizes malformed JSON-shaped input without throwing', () => {
    expect(() => normalizeData(undefined, '2026-07', settings)).not.toThrow();
    const data = normalizeData({
      schemaVersion: 'bad',
      month: 'bad',
      categories: 'bad',
      tasks: [
        null,
        { name: '有效任务', category: 'feature', planned: '2.25', status: 'bad' },
        { name: '', plannedHours: 5 }
      ],
      logs: [
        null,
        { date: '2026-07-01', taskId: 'missing', hours: '0', work: 'zero' },
        { date: '2026-07-32', taskId: 'missing', hours: '1', work: 'bad date' },
        { date: '2026-07-03', taskId: 'missing', hours: '1.5', work: 'valid' }
      ],
      dailyStatus: { completedDates: ['2026-07-03', '2026-07-99'] }
    }, '2026-07', settings);

    expect(data.schemaVersion).toBe(WORKLOG_SCHEMA_VERSION);
    expect(data.month).toBe('2026-07');
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0].id).toMatch(/^YZL20260701/);
    expect(data.tasks[0].plannedHours).toBe(2.25);
    expect(data.tasks[0].status).toBe('doing');
    expect(data.logs).toHaveLength(1);
    expect(data.logs[0].date).toBe('2026-07-03');
    expect(data.dailyStatus.completedDates).toEqual(['2026-07-03']);
  });

  test('migrates legacy schema fields into schema version 2', () => {
    const migrated = migrateData({
      schemaVersion: 1,
      month: '2026-07',
      taskTypes: [{ id: 'feature', label: '开发' }],
      completedDates: ['2026-07-01']
    }, '2026-07', settings);

    expect(migrated.schemaVersion).toBe(WORKLOG_SCHEMA_VERSION);
    expect(migrated.categories).toEqual([{ id: 'feature', label: '开发' }]);
    expect(migrated.dailyStatus.completedDates).toEqual(['2026-07-01']);
  });

  test('default data includes schema version and expected containers', () => {
    const data = defaultData('2026-07', settings);
    expect(data.schemaVersion).toBe(WORKLOG_SCHEMA_VERSION);
    expect(data.tasks).toEqual([]);
    expect(data.logs).toEqual([]);
    expect(data.dailyStatus).toEqual({ completedDates: [] });
  });
});

describe('worklog statistics', () => {
  test('calculates planned, actual, daily totals and status counts', () => {
    const data = sampleData();
    const d = deriveWorklogData(data);

    expect(d.totalPlanned).toBe(12.5);
    expect(d.totalActual).toBe(5.5);
    expect(d.daily.get('2026-07-01')).toBe(2.5);
    expect(d.daily.get('2026-07-02')).toBe(3);
    expect(d.statusCounts.done).toBe(1);
    expect(d.statusCounts.doing).toBe(1);
  });
});

describe('report markdown generation', () => {
  test('builds monthly report with escaped table pipes and empty fallbacks', () => {
    const report = buildMonthlyReportContent(sampleData(), 'worklog/data/2026/2026-07.json');

    expect(report).toContain('# 2026 年 7 月月度终结报告');
    expect(report).toContain('实现 A\\|B');
    expect(report).toContain('| 计划工时 | 12.5h |');
  });

  test('builds annual report from normalized monthly items', () => {
    const report = buildAnnualReportContent([{ data: sampleData() }], '2026', 'worklog/data');

    expect(report).toContain('# 2026 年度终结报告');
    expect(report).toContain('| 统计月份 | 1 个月 |');
    expect(report).toContain('| 2026-07 | 12.5h | 5.5h | -7h | 2 个 | 2 条 |');
  });

  test('handles empty annual data', () => {
    const report = buildAnnualReportContent([], '2026', 'worklog/data');

    expect(report).toContain('暂无月度数据。');
    expect(report).toContain('| 记录数 | 0 条 |');
  });
});
