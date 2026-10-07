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
