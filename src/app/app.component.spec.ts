import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AppComponent } from './app.component';

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should render the site title in the header', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('header')?.textContent).toContain(
      'Florida County Finance Explorer',
    );
  });

  it('should host a router outlet', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('router-outlet')).not.toBeNull();
  });
});

describe('AppComponent header actions', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [AppComponent], providers: [provideRouter([])] }).compileComponents();
  });

  afterEach(() => document.documentElement.removeAttribute('data-theme'));

  it('Share view copies the current URL', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const fixture = TestBed.createComponent(AppComponent);
    await fixture.componentInstance.share();
    expect(writeText).toHaveBeenCalledWith(location.href);
    expect(fixture.componentInstance.shareLabel()).toBe('Link copied');
  });

  it('Export is present but disabled', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    await fixture.whenStable();
    const exportBtn = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Export',
    );
    expect(exportBtn?.disabled).toBe(true);
  });

  it('theme button cycles Auto -> Light -> Dark and sets html[data-theme]', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    app.colorScheme.setMode('system');
    expect(app.themeLabel()).toBe('Auto');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    app.colorScheme.cycle();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(app.colorScheme.scheme()).toBe('light');
    app.colorScheme.cycle();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(app.colorScheme.scheme()).toBe('dark');
    app.colorScheme.cycle();
    expect(app.themeLabel()).toBe('Auto');
  });
});
