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
/** @type {<T,U>(x:T, f:(xx:T) => U) => U[]} */
const maybe = (x, f) => (x ? [f(x)] : []);

/**
 * @template K, V
 * @param {V[]} xs
 * @param {(v: V) => K} getKey
 * @returns {Map<K, V[]>}
 */
const groupBy = (xs, getKey) => {
  /** @type {Map<K, V[]>} */
  const m = new Map();
  for (const x of xs) {
    const key = getKey(x);
    const old = m.get(key) || [];
    m.set(key, [...old, x]);
  }
  return m;
};

/** @type {(crank: Crank) => boolean} */
const notRouting = crank => {
  const [first] = crank.events;
  return first.type !== 'crank-start' || first.crankType !== 'routing';
};

/** @param {SlogEntry} first */
const crankStartNum = first =>
  first.type === 'crank-start' ? first.crankNum : 0;

/**
 * @param {string} slogText
 * @returns {Crank[]}
 *
 * @typedef {{
 *   crankNum: number,
 *   events: Readonly<Readonly<SlogEntry>[]>,
 *   lines: Readonly<string[]>
 * }} Crank
 */
const parseCranks = slogText => {
  const lines = slogText.trim().split('\n');
  const cranks = [];
  let crankLines = [];
  let events = [];
  let crankNum = 0;
  const { freeze } = Object;
  for (const line of lines) {
    /** @type {SlogEntry} */
    const event = JSON.parse(line);
    while ((event.type === 'crank-start' ? event.crankNum : 0) > crankNum) {
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

const threshold = 8;
const fmtMsg = ({ body, slots }) => {
  const [method] = JSON.parse(body);
  const args = body.slice(`["${method}"]`.length);
  return `.${method}(${args.slice(0, threshold)}${
    args.length > threshold ? `...${args.length}` : ''
  }, ${slots.slice(0, 3).join(',')})`;
};

const { freeze, entries } = Object;

const fmtDot = () => {
  const q = s => JSON.stringify(s);
  /**
   * @param {Record<string,string|number>} attrs
   * @param {string=} sep
   */
  const fmtAttrs = (attrs, sep = ', ') => {
    const es = entries(attrs);
    return es.map(([n, v]) => `${n}=${q(v)}`).join(sep);
  };
  /** @param {Record<string,string|number>} attrs */
  const withAttrs = attrs => {
    const es = entries(attrs);
    return es.length === 0 ? '' : ' [' + fmtAttrs(attrs) + ']';
  };
  /** @param {string[]} parts */
  const rec = (...parts) => parts.join('|');
  return freeze({
    /**
     * @param {Record<string, string|number>} gAttrs
     * @param {string[]} items
     */
    digraph: (gAttrs, items) => `
      digraph {
        ${fmtAttrs(gAttrs, ';\n')}
        ${items.join('\n')}
      }`,
    fmtAttrs,
    withAttrs,
    /**
     * @param {string} c
     * @param {Record<string, string>} cAttrs
     * @param {string[]} items
     */
    nodeCluster: (c, cAttrs, items) =>
      `subgraph cluster_${c} { ${fmtAttrs(
        cAttrs,
      )}; node [shape=none]; ${c} [label=""]; ${[...items].join(';\n')} }`,
    arc: (src, dest, attrs = {}) => `${src} -> ${dest}` + withAttrs(attrs),
    node: (n, attrs) => n + withAttrs(attrs),
    rec,
    subRec: (...parts) => `{${rec(...parts)}}`,
    port: (port, part) => `<${port}> ${part}`,
    portRef: (node, port) => `${node}:${port}`,
  });
};

/**
 *
 * @param {Crank[]} cranks
 * @param {number} cranksToShow
 * @param {SlogAnnotation} notes
 * @typedef {{
 *   vats: Record<string, string>,
 *   exports: Record<string, Record<string, string>>,
 *   objects: Record<string, string>,
 * }} SlogAnnotation
 */
const slogToDot = (cranks, cranksToShow, notes) => {
  const vats = [];
  const sends = [];
  const invokes = [];
  const msgs = [];
  const notifies = [];
  const clist = {
    imports: /**@type {SlogCListEntry[]} */ ([]),
    exports: /**@type {SlogCListEntry[]} */ ([]),
    importing: /**@type {SlogCListEntry[]} */ ([]),
  };
  /** @type {Map<string, number>} */
  const typeCounts = new Map();
  /** @type {Map<string, string>} */
  const kopToVat = new Map();
  /** @type {Map<string, string[]>} */
  const pendingPromises = new Map();
  /** @type {Map<string, SlogSyscallEntry>} */
  const pendingSends = new Map();

  const events = cranks
    .slice(0, cranksToShow)
    .map(c => c.events)
    .flat();
  const currentCrankNum = crankStartNum(cranks[cranksToShow - 1].events[0]);

  for (const event of events) {
    const { type } = event;
    typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
    const current = crankStartNum(event) === currentCrankNum;

    switch (type) {
      case 'clist': {
        switch (event.mode) {
          case 'import':
            clist.imports.push(event);
            clist.importing.push(event);
            break;
          case 'export':
            clist.exports.push(event);
            kopToVat.set(event.kobj, event.vatID);
            break;
          case 'drop': {
            const ix = clist.importing.findIndex(
              e => e.vatID === event.vatID && e.kobj === event.kobj,
            );
            if (ix) clist.importing.splice(ix, 1);
            break;
          }
        }
        break;
      }
      case 'deliver':
        switch (event.kd[0]) {
          case 'startVat': {
            const { vatID } = event;
            const name = notes.vats[vatID];
            vats.push({ vatID, name });
            break;
          }

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
        const { ksc } = event;
        switch (ksc[0]) {
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
            const [_s, _t, { result }] = ksc;
            kopToVat.set(result, event.vatID);
            pendingSends.set(result, event);

            if (!current) break;

            sends.push(event);
            break;
          }
          case 'subscribe':
            pendingPromises.set(event.vatID, [
              ...(pendingPromises.get(event.vatID) || []),
              ksc[2],
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
    vats.map(({ vatID: v }) => [
      v,
      [...kopToVat.keys()].filter(o => kopToVat.get(o) === v),
    ]),
  );

  const d = fmtDot();

  const objToImpPort = new Map(
    vats.flatMap(v => {
      const cl = clist.exports.filter(
        e => e.vatID === v.vatID && !e.kobj.startsWith('kp'),
      );
      return cl.map(e => [e.kobj, d.portRef(`${v.vatID}_exports`, e.kobj)]);
    }),
  );
  console.log({ pendingPromises, pendingSends, msgs, objToImpPort });

  const portOpt = o => objToImpPort.get(o) || o;

  const msgArcs = msgs.map(({ kd: [_m, target, { methargs, result }] }) =>
    d.arc(kopToVat.get(result) || result, portOpt(target), {
      label: fmtMsg(methargs),
    }),
  );
  const pendingArc = kp => e =>
    d.arc(kp, portOpt(e.ksc[1]), {
      label: fmtMsg(e.ksc[2].methargs),
      style: 'dashed',
      fontsize: 8,
    });
  const pendingSendArcs = [...pendingPromises.values()].flatMap(kps =>
    kps.flatMap(kp => maybe(pendingSends.get(kp), pendingArc(kp))),
  );

  const clistByVat = new Map(
    vats.map(v => {
      const cl = clist.exports.filter(
        e => e.vatID === v.vatID && !e.kobj.startsWith('kp'),
      );
      return [v.vatID, cl];
    }),
  );

  const importsBySrc = groupBy(
    clist.importing.filter(
      ({ kobj }) => !kobj.startsWith('kp') && !kobj.startsWith('kd'),
    ),
    e => e.vatID,
  );

  const portLabel = (vatID, kobj) => notes.exports?.[vatID]?.[kobj] || kobj;
  const clistRec = vatID =>
    d.rec(
      'exports',
      ...(clistByVat.get(vatID) || die())?.map(({ vobj, kobj }) =>
        // d.subRec(vobj, d.port(kobj, portLabel(vatID, kobj))),
        d.port(kobj, portLabel(vatID, kobj)),
      ),
    );

  const importArcs = [];
  const clusters = vats.map(({ vatID, name }) => {
    const exp = clistByVat.get(vatID);
    const internalObjects = (vatContents.get(vatID) || die(vatID)).filter(
      o => !o.startsWith('kp') && exp?.filter(e => e.kobj === o).length === 0,
    );

    const importsByDest = groupBy(importsBySrc.get(vatID) || [], e =>
      kopToVat.get(e.kobj),
    );
    const importItems = [...importsByDest.entries()].flatMap(
      ([destVat, es2]) => {
        const id = `import_${vatID}_${destVat}`;
        const rec = d.node(id, {
          shape: 'record',
          fontsize: 10,
          label: d.rec(
            `from ${destVat || '??'}`,
            ...es2.map(({ kobj }) => notes.objects[kobj] || kobj),
          ),
          href: `#${es2.map(({ kobj }) => kobj).join('_')}`,
        });
        if (destVat) {
          importArcs.push(d.arc(id, destVat, { style: 'dotted' }));
        }
        return [rec];
      },
    );

    return d.nodeCluster(vatID, { label: name ? `${vatID}:${name}` : vatID }, [
      d.node(`${vatID}_exports`, {
        shape: 'record',
        fontsize: 10,
        label: clistRec(vatID),
      }),
      ...importItems,
      ...[
        ...internalObjects.map(d.node),
        ...(pendingPromises.get(vatID) || []).map(d.node),
      ],
    ]);
  });

  const objLabels = entries(notes.objects).map(([obj, label]) =>
    d.node(obj, { label, shape: 'none' }),
  );
  const pLabels = notifies.flatMap(e =>
    e.kd[1].map(r => d.node(r[0], { style: r[1] ? 'bold' : 'italic' })),
  );

  return d.digraph({ rankdir: 'LR', fontsize: 10 }, [
    ...objLabels,
    ...pLabels,
    ...clusters,
    ...pendingSendArcs,
    ...msgArcs,
    ...importArcs,
  ]);
};

const App =
  ({ renderDot, querySelector }) =>
  () => {
    const [reason, setReason] = useState(/** @type {Error | null} */ (null));
    const [cranks, setCranks] = useState(
      /** @type {{ crankNum: number, events: readonly any[], lines: readonly string[] }[]} */ ([]),
    );
    const [cranksToShow, setCranksToShow] = useState(1);
    const [notes, setNotes] = useState(
      /** @type {SlogAnnotation} */ (
        JSON.parse(querySelector('textarea[name="annotations"]').value)
      ),
    );

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
      if (!cranks.length) return;
      const dot = slogToDot(cranks, cranksToShow, notes);
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
  render(
    html`<${App({
      renderDot: globalThis.renderDot,
      querySelector: sel => document.querySelector(sel),
    })} />`,
    container,
  );
};

go();
