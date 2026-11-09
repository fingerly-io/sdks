/**
 * The Angular binding, driving the real SDK in a real browser.
 *
 * The unit tests mock `@fingerly/web-js`, which is right for testing the Angular
 * layer and proves nothing about the two fitting together. This does the
 * opposite: no mocks, the real collectors, and the binding used exactly as the
 * README documents it.
 *
 * One component rather than a card component with an input, because this
 * application is compiled just-in-time and JIT does not discover signal
 * inputs - they are found by the ahead-of-time compiler an app would normally
 * use.
 *
 * It uses `submit: false`, so no server answers: the raw report fills in and
 * the score, level and triggers stay empty, as they must with nobody to ask.
 */

// The compiler, first: this application is compiled in the page rather than
// ahead of time, and without this the first component fails asking for AOT.
import '@angular/compiler'

import { Component } from '@angular/core'
import { bootstrapApplication } from '@angular/platform-browser'

import { injectIdentify, provideFingerly } from '../src/index.js'

@Component({
  selector: 'fingerly-playground',
  standalone: true,
  template: `
    <h1>Fingerly — Angular binding</h1>

    <div class="bar">
      <button (click)="refresh()">refresh()</button>
      <span class="status">{{
        fingerly.isLoading() ? 'collecting…' : fingerly.isReady() ? 'ready' : 'idle'
      }}</span>
    </div>

    <div class="card">
      <h3>state</h3>
      <div class="row">
        <span class="k">suspectScore</span>
        <span class="v">{{ fingerly.suspectScore() ?? '— (no server answer)' }}</span>
      </div>
      <div class="row">
        <span class="k">suspectLevel</span>
        <span class="v" [class.hit]="fingerly.suspectLevel() === 'high'">{{ fingerly.suspectLevel() ?? '— (no server answer)' }}</span>
      </div>
      <div class="row">
        <span class="k">requestId</span>
        <span class="v">{{ fingerly.requestId() ?? '— (submit: false)' }}</span>
      </div>
      <div class="row">
        <span class="k">sources</span>
        <span class="v">{{ sourceCount() }}</span>
      </div>
      <div class="row">
        <span class="k">elapsed_ms</span>
        <span class="v">{{ fingerly.report()?.elapsed_ms ?? '—' }}</span>
      </div>
      <div class="row">
        <span class="k">engine</span>
        <span class="v">{{ fingerly.report()?.integrity?.engine?.observed ?? '—' }}</span>
      </div>
      @if (fingerly.error(); as failure) {
        <div class="row">
          <span class="k">error</span><span class="v hit">{{ failure.message }}</span>
        </div>
      }
    </div>

    <div class="grid">
      <div class="card">
        <h3>triggers</h3>
        @if (fingerly.triggers().length) {
          <ul class="reasons">
            @for (trigger of fingerly.triggers(); track trigger.signal) {
              <li>{{ trigger.signal }} ({{ trigger.group }})</li>
            }
          </ul>
        } @else {
          <div class="row"><span class="k">fired</span><span class="v">—</span></div>
        }
      </div>
    </div>
  `,
})
export class Playground {
  readonly fingerly = injectIdentify({ immediate: true, tag: 'angular-playground' })

  refresh(): void {
    void this.fingerly.refresh().catch(() => undefined)
  }

  sourceCount(): number | string {
    const report = this.fingerly.report()
    return report ? Object.keys(report.sources).length : '—'
  }
}

// submit: false - the playground collects and sends nothing.
void bootstrapApplication(Playground, {
  providers: [provideFingerly({ apiKey: 'pk_demo', submit: false })],
})
