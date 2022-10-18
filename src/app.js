// @ts-check
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

const slogToDot = events => {
  const sends = [];
  const kps = new Set();
  const kos = new Set();
  const kds = new Set();

  const kopToVat = new Map([
    ...events
      .filter(e => e.type === 'deliver' && e.kd[0] === 'message')
      .map(e => [e.kd[1], e.vatID]),
    ...events
      .filter(e => e.type === 'syscall' && e.ksc[0] === 'send')
      .map(e => [e.ksc[2].result, e.vatID]),
  ]);
  console.log({ koToVat: kopToVat });
  const vatContents = new Map(
    [...kopToVat.values()].map(v => [
      v,
      [...kopToVat.keys()].filter(o => kopToVat.get(o) === v),
    ]),
  );

  const subgraphs = [...vatContents.entries()].map(
    ([v, os]) => `subgraph cluster_${v} { label="${v}"; ${os.join(';')} }`,
  );

  for (const event of events) {
    const { monotime } = event;
    switch (event.type) {
      // case 'create-vat':
      //   // ... event.vatID ?
      //   break;
      case 'syscall': {
        const { ksc } = event;
        const [tag] = ksc;
        switch (tag) {
          case 'vatstoreGet':
          case 'vatstoreGetAfter':
          case 'vatstoreSet':
            break;
          case 'send': {
            const [
              _s,
              rx,
              {
                methargs: { body, slots },
                result,
              },
            ] = ksc;
            const [method] = JSON.parse(body);
            const edge = {
              monotime,
              crankNum: event.crankNum,
              srcVat: event.vatID,
              result,
              rx,
              method,
              body,
              slots,
            };
            sends.push(edge);
            kps.add(result);
            kos.add(rx);
            slots.forEach(slot => {
              if (slot.startsWith('ko')) {
                kos.add(slot);
              } else if (slot.startsWith('kd')) {
                kds.add(slot);
              } else if (slot.startsWith('kp')) {
                kps.add(slot);
              } else {
                die(slot);
              }
            });
          }
          default:
            console.log('syscall', event);
        }
        break;
      }
      default:
        break;
    }
    // if (sends.length > 5) {
    //   // @@@@@@@
    //   break;
    // }
  }

  const threshold = 8;
  const fmtMsg = (method, body, slots) => {
    return `${method}.(...${body.length}, ${slots.join(',')})`;
  };
  const arcs = sends.map(
    ({ result, srcVat, rx, method, body, slots }) =>
      `${result} -> ${rx} [label="${fmtMsg(method, body, slots)}"]`,
  );
  return [`digraph { edge [fontsize=8]; `, ...subgraphs, ...arcs, `}`].join(
    '\n',
  );
};

const App =
  ({ renderDot }) =>
  () => {
    const [reason, setReason] = useState(/** @type {Error | null} */ (null));
    const [slogText, setSlogText] = useState(
      /** @type {string | null} */ (null),
    );
    const [cranksToShow, setCranksToShow] = useState(1);
    const [highestCrank, setHighestCrank] = useState(0);

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
        setSlogText(txt);
      });
      fr.readAsText(file);
    };

    useEffect(() => {
      if (!slogText) return;
      const lines = slogText.trim().split('\n');
      const events = lines.map(s => JSON.parse(s));
      let highest = 0;
      for (const { crankNum } of events) {
        if (crankNum > highest) {
          highest = crankNum;
        }
      }
      setHighestCrank(highest);
    }, [slogText]);

    useEffect(() => {
      if (!slogText) return;
      const lines = slogText.trim().split('\n');
      const events = lines
        .map(s => JSON.parse(s))
        .filter(e => !(e.crankNum > cranksToShow));
      const dot = slogToDot(events);
      console.log('renderDot:', dot);
      renderDot(dot);
    }, [slogText, cranksToShow, highestCrank]);

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
            max=${highestCrank}
            onChange=${e => setCranksToShow(Number(e.target.value))}
        /></label>
        <br />
        ${cranksToShow} of ${highestCrank} cranks
      </fieldset>
    `;
  };

const go = () => {
  const container = document.querySelector('#ui') || die('missing #ui');
  render(html`<${App({ renderDot: globalThis.renderDot })} />`, container);
};

go();
