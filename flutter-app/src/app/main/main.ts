import { Component, Input, Output, EventEmitter, OnChanges, OnDestroy, OnInit, SimpleChanges, signal, ChangeDetectionStrategy, ChangeDetectorRef, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Button } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { AutoComplete } from 'primeng/autocomplete';
import { FloatLabel } from 'primeng/floatlabel';
import { Tag } from 'primeng/tag';
import { ChartModule } from 'primeng/chart';
import { ColorPicker } from 'primeng/colorpicker';
import { TrackerService, Category, DonutSegment, ProcessInfo, Totals } from '../tracker.service';
import { interval, Subscription, catchError, of } from 'rxjs';
import { App } from '../app';

interface DayChart {
  date: string;
  label: string;
  year: string;
  chartData: any;
  chartOptions: any;
  totalSeconds: number;
}

@Component({
  selector: 'app-main',
  imports: [CommonModule, FormsModule, Button, InputText, AutoComplete, Tag, FloatLabel, ChartModule, ColorPicker],
  templateUrl: './main.html',
  styleUrl: './main.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MainComponent implements OnInit, OnChanges, OnDestroy {
  @Input() pollIntervalMs = 15000;
  @Output() openStatsForDate = new EventEmitter<string>();

  chartData = signal<any>(null);
  chartOptions = signal<any>(null);
  categories = signal<Category[]>([]);
  activeProcess = signal('');
  donutSegments = signal<DonutSegment[]>([]);
  totalTracked = signal('0m');
  categoryTotals = signal<Record<string, number>>({});
  appTotals = signal<Record<string, number>>({});
  categoryColors = signal<Record<string, string>>({});
  appIcons = signal<Record<string, string>>({});
  pastDays = signal<DayChart[]>([]);
  showAddCategory = signal(false);
  newCategoryName = '';
  editingCategory = signal<string | null>(null);
  editCategoryName = '';
  showAddApp = signal<string | null>(null);
  selectedProcess: ProcessInfo | string | null = null;
  processes = signal<ProcessInfo[]>([]);
  filteredProcesses = signal<ProcessInfo[]>([]);

  colorPickerVisible = signal(false);
  colorPickerCategory = signal<string | null>(null);
  colorPickerValue = signal('#ffffff');
  hexInput = signal('');

  private pollSub?: Subscription;
  private platformId = inject(PLATFORM_ID);
  private cd = inject(ChangeDetectorRef);

  constructor(private tracker: TrackerService, private app: App) {}

  private readonly DONUT_COLORS = [
    '#907AD6', '#EDBBB4', '#ECE5F0', '#4F518C', '#c792ea',
    '#82aaff', '#f78c6c', '#c3e88d', '#89ddff', '#ffcb6b'
  ];

  ngOnInit(): void {
    this.loadCategoryColors();
    this.loadRules();
    this.refreshTotals();
    this.loadHistoryDonuts();
    this.startPolling();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['pollIntervalMs'] && !changes['pollIntervalMs'].firstChange) {
      this.startPolling();
    }
  }

  ngOnDestroy(): void {
    this.pollSub?.unsubscribe();
  }

  private startPolling(): void {
    this.pollSub?.unsubscribe();
    this.pollSub = interval(this.getSafePollInterval()).subscribe(() => {
      this.refreshTotals();
    });
  }

  private refreshTotals(): void {
    // Trigger health check when we ping the backend for totals
    this.app.triggerHealthCheck();

    this.tracker.getTotals().subscribe(t => {
      this.activeProcess.set(t.active_process);
      this.buildDonut(t);
    });
  }

  private loadHistoryDonuts(): void {
    this.tracker.getDailyTotals().subscribe(data => {
      const today = this.getLocalDateString();
      const colors = data.category_colors ?? {};
      this.pastDays.set(
        Object.entries(data.daily_totals_seconds)
          .filter(([day]) => day !== today)
          .sort(([a], [b]) => b.localeCompare(a))
          .map(([date, totals]) => {
            const [year, month, day] = date.split('-');
            const labels = Object.keys(totals).filter(cat => (totals as any)[cat] > 0);
            const dataValues = labels.map(cat => (totals as any)[cat]);
            const bgColors = labels.map((cat, idx) =>
              colors[cat] ?? this.DONUT_COLORS[idx % this.DONUT_COLORS.length]
            );
            const totalSeconds = dataValues.reduce((a, b) => a + b, 0);
            return {
              date,
              label: `${day}/${month}`,
              year,
              totalSeconds,
              chartData: {
                labels,
                datasets: [{
                  data: dataValues,
                  backgroundColor: bgColors,
                  borderColor: 'transparent',
                  borderRadius: 4
                }]
              },
              chartOptions: {
                animation: { animateRotate: false, duration: 0 },
                cutout: '65%',
                plugins: { legend: { display: false }, tooltip: { enabled: false } },
                maintainAspectRatio: false
              }
            };
          })
      );
    });
  }

  private getLocalDateString(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  formatDate(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  private getSafePollInterval(): number {
    const parsed = Number(this.pollIntervalMs);
    if (!Number.isFinite(parsed)) {
      return 15000;
    }
    return Math.max(500, Math.round(parsed));
  }

  loadRules(): void {
    this.tracker.getRules().subscribe(rules => {
      const map = new Map<string, string[]>();
      for (const r of rules) {
        if (!map.has(r.category)) map.set(r.category, []);
        map.get(r.category)!.push(r.process);
      }
      this.categories.set(
        [...map.entries()].map(([name, apps]) => ({ name, apps }))
      );
    });
  }

  loadCategoryColors(): void {
    this.tracker.getCategoryColors().subscribe(colors => {
      this.categoryColors.set(colors ?? {});
    });
  }

  addCategory(): void {
    if (!this.newCategoryName.trim()) return;
    const cat: Category = {
      name: this.newCategoryName.trim(),
      apps: []
    };
    this.categories.update(cats => [...cats, cat]);
    this.newCategoryName = '';
    this.showAddCategory.set(false);
  }

  editCategory(name: string): void {
    this.editingCategory.set(name);
    this.editCategoryName = name;
  }

  saveEditCategory(oldName: string): void {
    const newName = this.editCategoryName.trim();
    if (!newName || newName === oldName) { this.editingCategory.set(null); return; }
    const cat = this.categories().find(c => c.name === oldName);
    if (cat) {
      cat.apps.map(app => this.tracker.addRule(app, newName));
      cat.apps.forEach(app => this.tracker.deleteRule(app).subscribe());
    }
    this.categories.update(cats =>
      cats.map(c => c.name === oldName ? { ...c, name: newName } : c)
    );
    this.editingCategory.set(null);
  }

  deleteCategory(name: string): void {
    const cat = this.categories().find(c => c.name === name);
    if (cat) {
      cat.apps.forEach(app => this.tracker.deleteRule(app).subscribe());
    }
    this.categories.update(cats => cats.filter(c => c.name !== name));
  }

  openAddApp(categoryName: string): void {
    this.showAddApp.set(categoryName);
    this.selectedProcess = null;
    this.filteredProcesses.set([]);
    this.tracker.getProcesses().subscribe(p => this.processes.set(p));
  }

  filterProcesses(event: { query: string }): void {
    const q = event.query.toLowerCase();
    this.filteredProcesses.set(
      this.processes()
        .filter(p => p.name.toLowerCase().includes(q) || p.exe.toLowerCase().includes(q))
        .slice(0, 25)
    );
  }

  getAppTime(exe: string): string {
    const totals = this.appTotals();
    const key = Object.keys(totals).find(k => k.toLowerCase() === exe.toLowerCase());
    const secs = key ? totals[key] : 0;
    return secs >= 60 ? this.formatTime(secs) : '';
  }

  getCatTime(name: string): string {
    const secs = this.categoryTotals()[name] ?? 0;
    return secs >= 60 ? this.formatTime(secs) : '';
  }

  addAppToCategory(categoryName: string): void {
    const sel = this.selectedProcess;
    if (!sel) return;
    const app = typeof sel === 'object' && 'exe' in (sel as object)
      ? (sel as ProcessInfo).exe
      : String(sel).trim();
    if (!app) return;
    const cat = this.categories().find(c => c.name === categoryName);
    if (cat?.apps.some(a => a.toLowerCase() === app.toLowerCase())) {
      this.selectedProcess = null;
      this.showAddApp.set(null);
      return;
    }
    this.tracker.addRule(app, categoryName).subscribe(() => {
      this.categories.update(cats =>
        cats.map(c =>
          c.name === categoryName ? { ...c, apps: [...c.apps, app] } : c
        )
      );
      this.selectedProcess = null;
      this.showAddApp.set(null);
    });
  }

  removeApp(categoryName: string, app: string): void {
    this.tracker.deleteRule(app).subscribe(() => {
      this.categories.update(cats =>
        cats.map(c =>
          c.name === categoryName
            ? { ...c, apps: c.apps.filter(a => a !== app) }
            : c
        )
      );
    });
  }

  getCategoryColor(category: string, fallbackIndex?: number): string {
    const fromState = this.categoryColors()[category];
    if (fromState) {
      return fromState;
    }
    const index = fallbackIndex ?? 0;
    return this.DONUT_COLORS[index % this.DONUT_COLORS.length];
  }

  initColorPicker(category: string): void {
    const currentColor = this.getCategoryColor(category);
    this.colorPickerCategory.set(category);
    this.colorPickerValue.set(currentColor);
    this.hexInput.set(currentColor.toUpperCase());
  }

  onColorChange(color: string): void {
    this.colorPickerValue.set(color);
    this.hexInput.set(color.toUpperCase());
  }

  updateHexInput(hex: string): void {
    const trimmed = hex.trim().toUpperCase();
    this.hexInput.set(trimmed);
    if (this.isValidHex(trimmed)) {
      this.colorPickerValue.set(trimmed);
    }
  }

  applyColorAndCloseOverlay(category: string): void {
    const hex = this.hexInput().trim().toUpperCase();
    if (this.isValidHex(hex)) {
      this.updateCategoryColor(category, hex);
      this.closeColorPicker();
    }
  }

  closeColorPicker(): void {
    this.colorPickerCategory.set(null);
    this.colorPickerValue.set('#ffffff');
    this.hexInput.set('');
  }

  isValidHex(hex: string): boolean {
    return /^#[0-9A-F]{6}$/.test(hex);
  }

  updateCategoryColor(category: string, color: string): void {
    const normalized = this.normalizeHexColor(color);
    if (!normalized) {
      return;
    }
    this.categoryColors.update(current => ({ ...current, [category]: normalized }));
    this.tracker.setCategoryColor(category, normalized).subscribe();
  }

  private buildDonut(t: Totals): void {
    this.categoryTotals.set(t.totals_seconds);
    this.appTotals.set(t.app_totals_seconds ?? {});
    const entries = Object.entries(t.totals_seconds).filter(([, s]) => s > 0);
    const total = entries.reduce((sum, [, s]) => sum + s, 0);
    this.totalTracked.set(this.formatTime(total));

    if (total === 0) {
      this.chartData.set(null);
      this.donutSegments.set([]);
      return;
    }

    // Build chart data for PrimeNG
    if (isPlatformBrowser(this.platformId)) {
      const documentStyle = getComputedStyle(document.documentElement);
      const labels = entries.map(([cat]) => cat);
      const data = entries.map(([, secs]) => secs);
      const backgroundColor = entries.map(([cat], catIndex) => this.getCategoryColor(cat, catIndex));
      const hoverBackgroundColor = backgroundColor.map(color => this.lightenColor(color));

      const borderColor = documentStyle.getPropertyValue('--card-bg').trim() || '#1a1a1a';

      const chartData = {
        labels,
        datasets: [
          {
            data,
            backgroundColor,
            hoverBackgroundColor,
            borderColor,
            borderWidth: 2,
            borderRadius: 7.3
          }
        ]
      };

      const chartOptions = {
        animation: {
          animateRotate: false,
          duration: 400
        },
        cutout: '65%',
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            callbacks: {
              label: (context: any) => {
                const seconds = context.parsed;
                return this.formatTime(seconds);
              }
            }
          }
        },
        maintainAspectRatio: false
      };

      this.chartData.set(chartData);
      if (!this.chartOptions()) {
        this.chartOptions.set(chartOptions);
      }
      this.cd.markForCheck();
    }

    // Keep donutSegments for legacy reference if needed
    const CIRCUMFERENCE = 2 * Math.PI * 45;
    const GAP = 4;
    const totalGap = entries.length * GAP;
    const usable = CIRCUMFERENCE - totalGap;
    let offset = 0;
    const segments: DonutSegment[] = [];
    for (const [cat, secs] of entries) {
      const len = (secs / total) * usable;
      segments.push({
        color: this.getCategoryColor(cat, segments.length),
        offset,
        length: len,
        category: cat,
        seconds: secs
      });
      offset += len + GAP;
    }

    this.donutSegments.set(segments);

    // Load app icons for all apps
    this.loadAppIcons();
  }

  private loadAppIcons(): void {
    const cached = this.appIcons();
    const allApps = this.categories().flatMap(cat => cat.apps);
    const exeNames = allApps.filter(exe => !cached[exe]);

    for (const exe of exeNames) {
      this.tracker.getAppIcon(exe).pipe(catchError(() => of(null))).subscribe(res => {
        if (res?.data_url) {
          this.appIcons.update(icons => ({ ...icons, [exe]: res.data_url }));
        }
      });
    }
  }

  private lightenColor(color: string): string {
    // Simple color lightening for hover effect
    try {
      const hex = color.replace('#', '');
      const r = Math.min(255, parseInt(hex.substr(0, 2), 16) + 30);
      const g = Math.min(255, parseInt(hex.substr(2, 2), 16) + 30);
      const b = Math.min(255, parseInt(hex.substr(4, 2), 16) + 30);
      return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    } catch {
      return color;
    }
  }

  formatTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m`;
    return `${Math.round(seconds)}s`;
  }

  private normalizeHexColor(color: string): string | null {
    if (typeof color !== 'string') {
      return null;
    }
    const trimmed = color.trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
      return null;
    }
    return trimmed.toUpperCase();
  }
}
