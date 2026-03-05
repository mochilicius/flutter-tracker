import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { InputNumberModule } from 'primeng/inputnumber';
import { Button } from 'primeng/button';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
  imports: [FormsModule, InputNumberModule, Button],
})
export class SettingsComponent {
  private _pingValue = 15000;
  private toastTimer?: ReturnType<typeof setTimeout>;

  readonly statusMessage = signal<string | null>(null);

  @Output() pingValueChange = new EventEmitter<number>();

  @Input() set pingValue(value: number) {
    this._pingValue = this.normalizePingMs(value);
  }

  get pingValue(): number {
    return this._pingValue;
  }

  onPingChange(value: number | null): void {
    const normalized = this.normalizePingMs(value ?? this._pingValue);
    this._pingValue = normalized;
  }

  private normalizePingMs(value: number): number {
    if (!Number.isFinite(value)) {
      return 15000;
    }
    return Math.max(500, Math.round(value));
  }

  applySettings(): void {
    const normalized = this.normalizePingMs(this._pingValue);
    this._pingValue = normalized;
    this.pingValueChange.emit(normalized);

    this.statusMessage.set(`Settings applied. Ping interval is ${normalized} ms.`);
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
    }
    this.toastTimer = setTimeout(() => {
      this.statusMessage.set(null);
      this.toastTimer = undefined;
    }, 4500);
  }

  dismissMessage(): void {
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
      this.toastTimer = undefined;
    }
    this.statusMessage.set(null);
  }
}
