import { Component, Input, OnChanges, OnDestroy, OnInit, SimpleChanges, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Button } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { AutoComplete } from 'primeng/autocomplete';
import { FloatLabel } from 'primeng/floatlabel';
import { Tag } from 'primeng/tag';
import { TrackerService, Category, DonutSegment, ProcessInfo, Totals } from '../tracker.service';
import { interval, Subscription } from 'rxjs';

@Component({
  selector: 'app-main',
  imports: [CommonModule, FormsModule, Button, InputText, AutoComplete, Tag, FloatLabel],
  templateUrl: './main.html',
  styleUrl: './main.scss'
})
export class MainComponent implements OnInit, OnChanges, OnDestroy {
  @Input() pollIntervalMs = 15000;

  categories = signal<Category[]>([]);
  activeProcess = signal('');
  donutSegments = signal<DonutSegment[]>([]);
  totalTracked = signal('0m');
  categoryTotals = signal<Record<string, number>>({});
  appTotals = signal<Record<string, number>>({});
  categoryColors = signal<Record<string, string>>({});
  showAddCategory = signal(false);
  newCategoryName = '';
  editingCategory = signal<string | null>(null);
  editCategoryName = '';
  showAddApp = signal<string | null>(null);
  selectedProcess: ProcessInfo | string | null = null;
  processes = signal<ProcessInfo[]>([]);
  filteredProcesses = signal<ProcessInfo[]>([]);

  private pollSub?: Subscription;

  constructor(private tracker: TrackerService) {}

  private readonly DONUT_COLORS = [
    '#907AD6', '#EDBBB4', '#ECE5F0', '#4F518C', '#c792ea',
    '#82aaff', '#f78c6c', '#c3e88d', '#89ddff', '#ffcb6b'
  ];

  ngOnInit(): void {
    this.loadCategoryColors();
    this.loadRules();
    this.refreshTotals();
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
    this.tracker.getTotals().subscribe(t => {
      this.activeProcess.set(t.active_process);
      this.buildDonut(t);
    });
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
    if (total === 0) { this.donutSegments.set([]); return; }

    const CIRCUMFERENCE = 2 * Math.PI * 45;
    const GAP = 4;
    const totalGap = entries.length * GAP;
    const usable = CIRCUMFERENCE - totalGap;
    let offset = 0;
    const segments: DonutSegment[] = entries.map(([cat, secs], i) => {
      const len = (secs / total) * usable;
      const seg: DonutSegment = {
        color: this.getCategoryColor(cat, i),
        offset,
        length: len,
        category: cat,
        seconds: secs
      };
      offset += len + GAP;
      return seg;
    });
    this.donutSegments.set(segments);
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
