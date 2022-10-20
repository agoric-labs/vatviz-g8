// @ts-check
import { h, render } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';

/** @template T @typedef {[T, import("preact/hooks").StateUpdater<T>]} StateT<T> */

// Initialize htm with Preact
export const html = htm.bind(h);

const die = why => {
  throw new Error(why);
};

/** @type {(crank: Crank) => boolean} */
const notRouting = crank => crank.events[0].crankType !== 'routing';

/**
 * @param {string} slogText
 * @returns {Crank[]}
 *
 * @typedef {{ crankNum: number, events: Readonly<Readonly<SlogEvent>[]>, lines: Readonly<string[]> }} Crank
 * @typedef {{ time: number, monotime: number, crankNum?: number, type: string, crankType?: string }} SlogEvent
 */
const parseCranks = slogText => {
  const lines = slogText.trim().split('\n');
  const cranks = [];
  let crankLines = [];
  let events = [];
  let crankNum = 0;
  const { freeze } = Object;
  for (const line of lines) {
    /** @type {SlogEvent} */
    const event = JSON.parse(line);
    while ((event.crankNum || 0) > crankNum) {
      cranks.push(
        freeze({
          crankNum,
          events: freeze(events),
          lines: freeze(crankLines),
        }),
      );
      events = [];
      crankLines = [];
      crankNum += 1;
    }
    events.push(freeze(event));
    crankLines.push(line.slice(0, 1024));
  }
  if (events.length > 0) {
    cranks.push(
      freeze({
        crankNum,
        events: freeze(events),
        lines: freeze(crankLines),
      }),
    );
  }
  freeze(cranks);

  return cranks;
};

const slogToDot = (cranks, cranksToShow) => {
  const sends = [];
  const invokes = [];
  const msgs = [];
  const notifies = [];
  const imports = [];
  /** @type {Map<string, number>} */
  const typeCounts = new Map();
  const kopToVat = new Map();
  /** @type {Map<string, string[]>} */
  const pendingPromises = new Map();
  const pendingSends = new Map();

  const threshold = 8;
  const fmtMsg = ({ body, slots }) => {
    const [method] = JSON.parse(body);
    return `.${method}(...${body.length}, ${slots.join(',')})`;
  };

  const events = cranks
    .slice(0, cranksToShow)
    .map(c => c.events)
    .flat();
  const currentCrankNum = cranks[cranksToShow - 1].events[0].crankNum;

  for (const event of events) {
    const { type } = event;
    typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
    const current = event.crankNum === currentCrankNum;

    switch (type) {
      // case 'create-vat':
      //   // ... event.vatID ?
      //   break;
      case 'clist': {
        switch (event.mode) {
          case 'import':
            if (event.kobj.startsWith('kd')) {
              kopToVat.set(event.kobj, 'kernel');
            }
            if (current) break;
            imports.push(event);
            break;
          case 'export':
            kopToVat.set(event.kobj, event.vatID);
        }
        break;
      }
      case 'deliver':
        switch (event.kd[0]) {
          case 'message': {
            const { vatID, kd, crankNum } = event;
            const [_m, target, { result }] = kd;
            kopToVat.set(target, vatID);

            if (!current) break;
            msgs.push(event);
            break;
          }
          case 'notify': {
            const [_n, resolutions] = event.kd;
            if (current) {
              notifies.push(event);
              break;
            }
            for (const [kp] of resolutions) {
              const ps = pendingPromises.get(event.vatID) || [];
              pendingPromises.set(
                event.vatID,
                ps.filter(p => p !== kp),
              );
            }
            break;
          }
        }
        break;
      case 'syscall': {
        switch (event.ksc[0]) {
          case 'vatstoreGet':
          case 'vatstoreGetAfter':
          case 'vatstoreSet':
            break;
          case 'invoke': {
            if (!current) break;
            invokes.push(event);
            break;
          }
          case 'send': {
            const [_s, _t, { result }] = event.ksc;
            kopToVat.set(result, event.vatID);
            pendingSends.set(result, event);

            if (!current) break;

            sends.push(event);
            break;
          }
          case 'subscribe':
            pendingPromises.set(event.vatID, [
              ...(pendingPromises.get(event.vatID) || []),
              event.ksc[2],
            ]);
            break;

          default:
          // console.debug('syscall', event);
        }
        break;
      }
      default:
        break;
    }
  }
  console.log({ typeCounts });

  const vatContents = new Map(
    [...kopToVat.values()].map(v => [
      v,
      [...kopToVat.keys()].filter(o => kopToVat.get(o) === v),
    ]),
  );
  console.log({ kopToVat, vatContents, pendingPromises });

  // @@@ TODO/IDEA: show clists as records with o+N as well as voM
  // group vat A's imported objects by vat from whence they come.
  // make just 1 arrow for all of them to B.
  const subgraphs = [...vatContents.entries()].map(
    ([v, os]) =>
      `subgraph cluster_${v} { label="${v}"; node [shape=none]; ${v}; ${[
        ...os.filter(o => !o.startsWith('kp')),
        ...(pendingPromises.get(v) || []),
      ].join(';')} }`,
  );

  const msgArcs = msgs.map(
    ({ kd: [_m, target, { methargs, result }] }) =>
      `${kopToVat.get(result) || result} -> ${target} [label="${fmtMsg(
        methargs,
      )}"]`,
  );
  const notifyNodes = notifies.flatMap(({ kd: [_n, rs] }) =>
    rs.map(([kp, res]) => `${kp} [label="${kp}: ${res.state}"]`),
  );
  console.log(cranksToShow, 'msgs', msgs, notifyNodes);

  const sendArcs = sends.map(
    ({ vatID, ksc: [_s, target, { methargs }] }) =>
      `${vatID} -> ${target} [label="${fmtMsg(methargs)}"]`,
  );
  const invokeArcs = invokes.map(
    ({ vatID, ksc: [_s, target, method, { body, slots }] }) =>
      `${vatID} -> ${target} [label="${`.${method}(...${
        body.length
      }, ${slots.join(',')})`}"]`,
  );
  const fmtEvents = (kp, e) =>
    e ? [`${kp} [label="${kp} <- ${fmtMsg(e.ksc[2].methargs)}"]`] : [];

  // @@@IDEA/TODO: use arc labels
  const sendNodes = [...pendingPromises.values()].flatMap(kps =>
    kps.flatMap(kp => fmtEvents(kp, pendingSends.get(kp))),
  );
  const importArcs = imports
    .filter(({ kobj }) => !kobj.startsWith('kp'))
    .map(({ vatID, kobj }) => `${vatID} -> ${kobj} [style=dotted]`);
  return [
    `digraph {
      rankdir=LR;
      edge [fontsize=8]; `,
    ...subgraphs,
    ...importArcs,
    ...sendArcs,
    ...invokeArcs,
    ...msgArcs,
    ...notifyNodes,
    ...sendNodes,
    `}`,
  ].join('\n');
};

const App =
  ({ renderDot }) =>
  () => {
    const [reason, setReason] = useState(/** @type {Error | null} */ (null));
    const [cranks, setCranks] = useState(
      /** @type {{ crankNum: number, events: readonly any[], lines: readonly string[] }[]} */ ([]),
    );
    const [cranksToShow, setCranksToShow] = useState(1);

    const handler = ev => {
      const [file] = ev.target?.files;
      if (!file) {
        console.warn('no file?!');
        return;
      }
      const fr = new FileReader();
      fr.addEventListener('load', () => {
        const txt =
          typeof fr.result === 'string'
            ? fr.result
            : die(`expected string; got: ${fr.result}`);
        console.log({ txt: txt.slice(0, 80) });
        setCranks(parseCranks(txt).filter(notRouting));
      });
      fr.readAsText(file);
    };

    useEffect(() => {
      const dot = slogToDot(cranks, cranksToShow);
      console.log('renderDot:', dot);
      renderDot(dot);
    }, [cranks, cranksToShow]);

    return html`
      <fieldset>
        <label
          >SLOG file: <input type="file" name="slog" onChange=${handler}
        /></label>
        <br />
        <label
          >Show:
          <input
            type="range"
            min="1"
            max=${cranks.length}
            onChange=${e => setCranksToShow(Number(e.target.value))}
        /></label>
        <br />
        ${cranksToShow} of ${cranks.length} cranks
      </fieldset>
      <textarea rows="15" cols="120">
      ${(cranks[cranksToShow - 1]?.lines || []).join('\n')}
      </textarea
      >
    `;
  };

const go = () => {
  const container = document.querySelector('#ui') || die('missing #ui');
  render(html`<${App({ renderDot: globalThis.renderDot })} />`, container);
};

go();
