import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { providePrimeNG } from 'primeng/config';
import { definePreset } from '@primeuix/themes';
import Aura from '@primeuix/themes/aura';

const AppTheme = definePreset(Aura, {
  semantic: {
    primary: {
      50: '#f5f0ff',
      100: '#ECE5F0',
      200: '#d4c5e2',
      300: '#c9b1d0',
      400: '#a892c8',
      500: '#907AD6',
      600: '#7a62c4',
      700: '#4F518C',
      800: '#352f5a',
      900: '#2C2A4A',
      950: '#1e1c36',
    },
    colorScheme: {
      dark: {
        primary: {
          color: '{primary.500}',
          inverseColor: '{primary.100}',
          hoverColor: '{primary.400}',
          activeColor: '{primary.600}',
        },
        highlight: {
          background: 'rgba(144, 122, 214, 0.16)',
          focusBackground: 'rgba(144, 122, 214, 0.24)',
          color: '#ECE5F0',
          focusColor: '#ECE5F0',
        },
        formField: {
          background: '#352f5a',
          disabledBackground: '#2C2A4A',
          filledBackground: '#352f5a',
          filledHoverBackground: '#352f5a',
          filledFocusBackground: '#352f5a',
          borderColor: '#4F518C',
          hoverBorderColor: '#907AD6',
          focusBorderColor: '#907AD6',
          invalidBorderColor: '#EDBBB4',
          color: '#ECE5F0',
          disabledColor: '#b8aec5',
          placeholderColor: '#b8aec5',
          invalidPlaceholderColor: '#EDBBB4',
          floatLabelColor: '#b8aec5',
          floatLabelFocusColor: '#907AD6',
          floatLabelActiveColor: '#b8aec5',
          floatLabelInvalidColor: '#EDBBB4',
          iconColor: '#b8aec5',
          shadow: 'none',
        },
        floatLabel: {
          onBackground: '#352f5a',
          onFocusBackground: '#352f5a',
          onActiveBackground: '#352f5a',
        },
        surface: {
          0: '#ECE5F0',
          50: '#c9b1d0',
          100: '#b8aec5',
          200: '#907AD6',
          300: '#4F518C',
          400: '#3d3e70',
          500: '#352f5a',
          600: '#2C2A4A',
          700: '#231f3d',
          800: '#1a1730',
          900: '#110e22',
          950: '#0d0b1a',
        }
      }
    }
  }
});

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(),
    provideAnimationsAsync(),
    providePrimeNG({
      theme: {
        preset: AppTheme,
        options: {
          darkModeSelector: ':root',
          cssLayer: false,
        }
      }
    })
  ]
};
