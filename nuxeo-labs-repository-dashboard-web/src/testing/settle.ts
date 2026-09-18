import { ComponentFixture } from '@angular/core/testing';

/**
 * Drains the asynchronous work a dashboard page kicks off before asserting.
 *
 * The application is zoneless and talks to the server through plain `fetch`, so `whenStable()`
 * alone does not know about those promises. Cycling through a few macrotasks lets the config
 * load, the searches resolve and the label lookups complete, each of which depends on the
 * previous one.
 */
export async function settle(fixture: ComponentFixture<unknown>, rounds = 12): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
  }
  await fixture.whenStable();
  fixture.detectChanges();
}
