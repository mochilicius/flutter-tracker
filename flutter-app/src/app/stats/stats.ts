import { Component, Input, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CommonModule } from '@angular/common';
import { ChartModule } from 'primeng/chart';
import { TrackerService } from '../tracker.service';
import { forkJoin, interval, Subscription, catchError, of } from 'rxjs';

const CHART_H = 32;
const COL_W = 11;

interface HourStack {
  y: number;
  height: number;
  color: string;
  category: string;
}

interface HourBar {
  hour: number;
  x: number;
  stacks: HourStack[];
}

interface AppEntry {
  exe: string;
  seconds: number;
}

interface CategoryBreakdown {
  name: string;
  color: string;
  totalSeconds: number;
  apps: AppEntry[];
}

interface DayDonutChart {
  date: string;
  label: string;
  chartData: any;
  chartOptions: any;
  totalSeconds: number;
}

@Component({
  selector: 'app-stats',
  imports: [CommonModule, ChartModule],
  templateUrl: './stats.html',
  styleUrl: './stats.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StatsComponent implements OnInit, OnDestroy {
  @Input() preselectedDate: string | null = null;

  chartData: any = null;
  chartOptions: any = null;
  hourBars: HourBar[] = [];
  categoryBreakdowns: CategoryBreakdown[] = [];
  hasHourData = false;
  hasAppData = false;

  selectedDate = signal<string>('');
  availableDates = signal<string[]>([]);
  dayDonutCharts = signal<DayDonutChart[]>([]);
  appIcons = signal<Record<string, string>>({});

  readonly labelHours = [0, 6, 12, 18];
  readonly chartW = 24 * COL_W;
  readonly chartH = CHART_H;
  readonly svgH = CHART_H + 20;

  private pollSub?: Subscription;
  private categoryColors: Record<string, string> = {};
  private platformId = inject(PLATFORM_ID);
  private cd = inject(ChangeDetectorRef);
  private allDailyTotals: Record<string, Record<string, number>> = {};

  private readonly DONUT_COLORS = [
    '#907AD6', '#EDBBB4', '#ECE5F0', '#4F518C', '#c792ea',
    '#82aaff', '#f78c6c', '#c3e88d', '#89ddff', '#ffcb6b'
  ];

  constructor(private tracker: TrackerService) {}

  ngOnInit(): void {
    this.tracker.getDailyTotals().subscribe(data => {
      const dates = Object.keys(data.daily_totals_seconds ?? {}).sort().reverse();
      this.availableDates.set(dates);
      if (dates.length > 0) {
        const initial = (this.preselectedDate && dates.includes(this.preselectedDate))
          ? this.preselectedDate
          : dates[0];
        this.selectedDate.set(initial);
        this.allDailyTotals = data.daily_totals_seconds ?? {};
        this.categoryColors = data.category_colors ?? {};
        this.buildDayDonutCharts(data);
        this.loadDataForDate(initial, data);
      }
    });
    this.pollSub = interval(30000).subscribe(() => {
      const selected = this.selectedDate();
      if (selected) {
        this.tracker.getDailyTotals().subscribe(data => {
          this.allDailyTotals = data.daily_totals_seconds ?? {};
          this.categoryColors = data.category_colors ?? {};
          this.buildDayDonutCharts(data);
          this.loadDataForDate(selected, data);
        });
      }
    });
  }

  ngOnDestroy(): void {
    this.pollSub?.unsubscribe();
  }

  selectDate(date: string): void {
    this.selectedDate.set(date);
    this.tracker.getDailyTotals().subscribe(data => {
      this.loadDataForDate(date, data);
    });
  }

  private loadDataForDate(date: string, allData: any): void {
    this.tracker.getRules().subscribe(rules => {
      const hourlyData = allData.daily_hourly_seconds?.[date] ?? {};
      const appTotals = allData.daily_app_totals_seconds?.[date] ?? {};

      const hasData = Object.values(hourlyData).some(h => {
        return (h as number[]).some(v => v > 0);
      });

      this.hasHourData = hasData;
      this.hourBars = this.buildHourBars(hourlyData);

      if (isPlatformBrowser(this.platformId)) {
        this.buildStackedBarChart(hourlyData);
      }

      this.hasAppData = Object.keys(appTotals).length > 0;
      this.categoryBreakdowns = this.buildCategoryBreakdowns(appTotals, rules);
      this.loadIconsForBreakdowns();
      this.cd.markForCheck();
    });
  }

  private buildDayDonutCharts(data: any): void {
    const dates = Object.keys(data.daily_totals_seconds ?? {}).sort().reverse();
    const dayCharts: DayDonutChart[] = dates.map(date => {
      const totals = data.daily_totals_seconds?.[date] ?? {};
      const labels = Object.keys(totals).filter(cat => totals[cat] > 0);
      const dataValues = labels.map(cat => totals[cat]);
      const colors = labels.map((cat, idx) =>
        data.category_colors?.[cat] ?? this.DONUT_COLORS[idx % this.DONUT_COLORS.length]
      );
      const totalSecs = dataValues.reduce((a, b) => a + b, 0);

      return {
        date,
        label: this.formatDateShort(date),
        totalSeconds: totalSecs,
        chartData: {
          labels,
          datasets: [{
            data: dataValues,
            backgroundColor: colors,
            borderColor: 'transparent',
            borderRadius: 4
          }]
        },
        chartOptions: {
          cutout: '65%',
          plugins: { legend: { display: false }, tooltip: { enabled: false } },
          maintainAspectRatio: false
        }
      };
    });
    this.dayDonutCharts.set(dayCharts);
  }

  private formatDateShort(dateStr: string): string {
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}`;
  }

  private buildStackedBarChart(hourlyData: Record<string, number[]>): void {
    const categories = Object.keys(hourlyData).sort();
    const labels = Array.from({ length: 24 }, (_, h) => `${h}:00`);

    const datasets = categories.map((cat, idx) => ({
      label: cat,
      data: hourlyData[cat] || [],
      backgroundColor: this.categoryColors[cat] ?? this.DONUT_COLORS[idx % this.DONUT_COLORS.length],
      order: 0
    }));

    const documentStyle = getComputedStyle(document.documentElement);
    const textColor = documentStyle.getPropertyValue('--muted').trim() || '#b8aec5';
    const gridColor = documentStyle.getPropertyValue('--border').trim() || '#4F518C';

    this.chartData = {
      labels,
      datasets
    };

    this.chartOptions = {
      indexAxis: 'x',
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          labels: {
            color: textColor,
            padding: 16
          },
          position: 'bottom'
        },
        tooltip: {
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          titleColor: '#fff',
          bodyColor: '#fff',
          padding: 12,
          displayColors: true,
          callbacks: {
            label: (context: any) => {
              const label = context.dataset.label || '';
              const value = context.parsed.y;
              return label + ': ' + this.formatTime(value);
            }
          }
        }
      },
      scales: {
        x: {
          stacked: true,
          ticks: {
            color: textColor,
            font: { size: 11 }
          },
          grid: {
            color: gridColor,
            drawBorder: false
          }
        },
        y: {
          stacked: true,
          ticks: {
            color: textColor,
            font: { size: 11 },
            callback: (value: any) => this.formatTime(value)
          },
          grid: {
            color: gridColor,
            drawBorder: false
          }
        }
      }
    };
  }

  private getLocalDateString(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private buildHourBars(hourlyData: Record<string, number[]>): HourBar[] {
    const categories = Object.keys(hourlyData);
    const hourTotals = Array.from({ length: 24 }, (_, h) =>
      categories.reduce((sum, cat) => sum + (hourlyData[cat]?.[h] ?? 0), 0)
    );
    const maxTotal = Math.max(...hourTotals, 1);

    return Array.from({ length: 24 }, (_, h) => {
      let bottom = CHART_H;
      const stacks: HourStack[] = [];
      categories.forEach((cat, ci) => {
        const secs = hourlyData[cat]?.[h] ?? 0;
        if (secs <= 0) return;
        const height = Math.max(1, (secs / maxTotal) * CHART_H);
        stacks.push({
          y: bottom - height,
          height,
          color: this.getCategoryColor(cat, ci),
          category: cat,
        });
        bottom -= height;
      });
      return { hour: h, x: h * COL_W, stacks };
    });
  }

  private buildCategoryBreakdowns(
    appTotals: Record<string, number>,
    rules: { process: string; category: string }[]
  ): CategoryBreakdown[] {
    const catMap = new Map<string, string[]>();
    for (const r of rules) {
      if (!catMap.has(r.category)) catMap.set(r.category, []);
      catMap.get(r.category)!.push(r.process);
    }

    const result: CategoryBreakdown[] = [];
    let ci = 0;
    for (const [name, apps] of catMap.entries()) {
      const entries = apps
        .map(exe => ({ exe, secs: this.lookupAppTime(exe, appTotals) }))
        .filter(e => e.secs > 0)
        .sort((a, b) => b.secs - a.secs);

      const totalSeconds = entries.reduce((s, e) => s + e.secs, 0);
      if (totalSeconds > 0) {
        result.push({
          name,
          color: this.getCategoryColor(name, ci),
          totalSeconds,
          apps: entries.map(e => ({ exe: e.exe, seconds: e.secs })),
        });
      }
      ci++;
    }
    return result.sort((a, b) => b.totalSeconds - a.totalSeconds);
  }

  private lookupAppTime(exe: string, appTotals: Record<string, number>): number {
    const key = Object.keys(appTotals).find(k => k.toLowerCase() === exe.toLowerCase());
    return key ? appTotals[key] : 0;
  }

  private loadIconsForBreakdowns(): void {
    const cached = this.appIcons();
    const exeNames = this.categoryBreakdowns
      .flatMap(cat => cat.apps.map(a => a.exe))
      .filter(exe => !cached[exe]);

    for (const exe of exeNames) {
      this.tracker.getAppIcon(exe).pipe(catchError(() => of(null))).subscribe(res => {
        if (res?.data_url) {
          this.appIcons.update(icons => ({ ...icons, [exe]: res.data_url }));
        }
      });
    }
  }

  private getCategoryColor(category: string, fallbackIndex: number): string {
    return this.categoryColors[category] ?? this.DONUT_COLORS[fallbackIndex % this.DONUT_COLORS.length];
  }

  formatTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m`;
    return `${Math.round(seconds)}s`;
  }

  hourTickLabel(h: number): string {
    if (h === 0) return '12a';
    if (h < 12) return `${h}a`;
    if (h === 12) return '12p';
    return `${h - 12}p`;
  }
}
