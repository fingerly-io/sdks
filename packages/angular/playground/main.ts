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
 * use. The five verdicts are built here instead, in a field initialiser, which
 * is an injection context and is where `injectVerdict()` belongs anyway.
 *
 * Open it twice - an ordinary window and a private one - and watch the
 * incognito card change. That pair is the only real test that verdict gets.
 */

// The compiler, first: this application is compiled in the page rather than
// ahead of time, and without this the first component fails asking for AOT.
import '@angular/compiler'

import { Component } from '@angular/core'
import { bootstrapApplication } from '@angular/platform-browser'

import { injectIdentify, injectVerdict, provideFingerly, type VerdictName } from '../src/index.js'

const NAMES: VerdictName[] = ['incognito', 'shields', 'tor', 'emulator', 'automation', 'farm']

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
        <span class="k">isSuspicious</span>
        <span class="v" [class.hit]="fingerly.isSuspicious()">{{ fingerly.isSuspicious() }}</span>
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
      @for (card of cards; track card.name) {
        <div class="card">
          <h3>{{ card.name }}</h3>
          <div class="row">
            <span class="k">matched</span>
            <span class="v" [class.hit]="card.verdict.matched()">{{ card.verdict.matched() }}</span>
          </div>
          <div class="row">
            <span class="k">confidence</span>
            <span class="v">{{ card.verdict.confidence() ?? '—' }}</span>
          </div>
          @if (card.verdict.reasons().length) {
            <ul class="reasons">
              @for (reason of card.verdict.reasons(); track reason) {
                <li>{{ reason }}</li>
              }
            </ul>
          }
        </div>
      }
    </div>
  `,
})
export class Playground {
  readonly fingerly = injectIdentify({ immediate: true, tag: 'angular-playground' })

  // Five verdicts reading one identification, which is the rule this
  // playground is here to show.
  readonly cards = NAMES.map((name) => ({ name, verdict: injectVerdict(name) }))

  refresh(): void {
    void this.fingerly.refresh().catch(() => undefined)
  }

  sourceCount(): number | string {
    const report = this.fingerly.report()
    return report ? Object.keys(report.sources).length : '—'
  }
}

// submit: false - the playground collects and scores locally, and sends
// nothing.
void bootstrapApplication(Playground, {
  providers: [provideFingerly({ apiKey: 'pk_demo', submit: false })],
})
