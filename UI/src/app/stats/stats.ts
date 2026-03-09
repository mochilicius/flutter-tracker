import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TrackerService } from '../tracker.service';
import { forkJoin, interval, Subscription } from 'rxjs';

const CHART_H = 48;
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
  fraction: number;
}

interface CategoryBreakdown {
  name: string;
  color: string;
  totalSeconds: number;
  apps: AppEntry[];
}

@Component({
  selector: 'app-stats',
  imports: [CommonModule],
  templateUrl: './stats.html',
  styleUrl: './stats.scss'
})
export class StatsComponent implements OnInit, OnDestroy {
  hourBars: HourBar[] = [];
  categoryBreakdowns: CategoryBreakdown[] = [];
  hasHourData = false;
  hasAppData = false;

  readonly labelHours = [0, 6, 12, 18];
  readonly chartW = 24 * COL_W;
  readonly chartH = CHART_H;
  readonly svgH = CHART_H + 20;

  private pollSub?: Subscription;
  private categoryColors: Record<string, string> = {};

  private readonly DONUT_COLORS = [
    '#907AD6', '#EDBBB4', '#ECE5F0', '#4F518C', '#c792ea',
    '#82aaff', '#f78c6c', '#c3e88d', '#89ddff', '#ffcb6b'
  ];

  constructor(private tracker: TrackerService) {}

  ngOnInit(): void {
    this.load();
    this.pollSub = interval(30000).subscribe(() => this.load());
  }

  ngOnDestroy(): void {
    this.pollSub?.unsubscribe();
  }

  private load(): void {
    forkJoin({
      daily: this.tracker.getDailyTotals(),
      rules: this.tracker.getRules(),
    }).subscribe(({ daily, rules }) => {
      this.categoryColors = daily.category_colors ?? {};
      const today = new Date().toISOString().split('T')[0];

      const hourlyData = daily.daily_hourly_seconds?.[today] ?? {};
      this.hasHourData = Object.values(hourlyData).some(h => h.some(v => v > 0));
      this.hourBars = this.buildHourBars(hourlyData);

      const appTotals = daily.daily_app_totals_seconds?.[today] ?? {};
      this.hasAppData = Object.keys(appTotals).length > 0;
      this.categoryBreakdowns = this.buildCategoryBreakdowns(appTotals, rules);
    });
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
          apps: entries.map(e => ({
            exe: e.exe,
            seconds: e.secs,
            fraction: e.secs / totalSeconds,
          })),
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
