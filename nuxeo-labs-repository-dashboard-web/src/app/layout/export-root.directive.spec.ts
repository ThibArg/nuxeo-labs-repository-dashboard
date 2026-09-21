import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ExportRootDirective } from './export-root.directive';
import { stubSession } from '../../testing/session.stub';

@Component({
  imports: [ExportRootDirective],
  template: `
    <header data-testid="chrome">Controls, which a snapshot has no use for</header>
    <div nxdExportRoot data-testid="dashboard">Figures</div>
  `,
})
class HostComponent {}

describe('nxdExportRoot', () => {
  /**
   * A view query would answer whatever component happened to be first. Only the page knows where
   * its dashboard stops and its chrome begins, and on a bespoke layout that line is wherever its
   * author drew it — so the element says so itself.
   */
  it('hands the session the element the page marked, not the one above it', () => {
    const stubbed = stubSession(null);
    TestBed.configureTestingModule({ providers: [stubbed.provider] });

    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    expect(stubbed.state.exportRoot?.getAttribute('data-testid')).toBe('dashboard');
  });

  it('registers nothing when no element carries it', () => {
    const stubbed = stubSession(null);
    TestBed.configureTestingModule({ providers: [stubbed.provider] });

    expect(stubbed.state.exportRoot).toBeNull();
  });
});
