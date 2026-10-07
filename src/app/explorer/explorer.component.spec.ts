import { TestBed } from '@angular/core/testing';
import { ExplorerComponent } from './explorer.component';

describe('ExplorerComponent', () => {
  it('should create', async () => {
    const fixture = TestBed.createComponent(ExplorerComponent);
    await fixture.whenStable();
    expect(fixture.componentInstance).toBeTruthy();
  });
});
