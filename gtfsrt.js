// Minimal GTFS-Realtime decoder. Reads only the fields this app needs:
// FeedMessage.entity -> TripUpdate -> (trip.route_id, stop_time_update[stop_id, arrival/departure.time])

function reader(buf) {
  let pos = 0;
  const varint = () => {
    let result = 0, mul = 1, b;
    do {
      b = buf[pos++];
      result += (b & 0x7f) * mul;
      mul *= 128;
    } while (b & 0x80);
    return result;
  };
  return {
    get pos() { return pos; },
    varint,
    // Yields [fieldNumber, wireType, valueOrSubarray]
    *fields(end = buf.length) {
      while (pos < end) {
        const key = varint();
        const field = Math.floor(key / 8), wire = key & 7;
        if (wire === 0) yield [field, wire, varint()];
        else if (wire === 2) {
          const len = varint();
          const sub = buf.subarray(pos, pos + len);
          pos += len;
          yield [field, wire, sub];
        } else if (wire === 1) { pos += 8; }
        else if (wire === 5) { pos += 4; }
        else throw new Error(`Unsupported wire type ${wire}`);
      }
    },
  };
}

const text = new TextDecoder();

function eventTime(buf) {
  for (const [f, , v] of reader(buf).fields()) if (f === 2) return v;
  return null;
}

function stopTimeUpdate(buf) {
  let stopId = null, arrival = null, departure = null;
  for (const [f, , v] of reader(buf).fields()) {
    if (f === 4) stopId = text.decode(v);
    else if (f === 2) arrival = eventTime(v);
    else if (f === 3) departure = eventTime(v);
  }
  return { stopId, time: arrival ?? departure };
}

function tripUpdate(buf) {
  let routeId = null, tripId = null;
  const stops = [];
  for (const [f, , v] of reader(buf).fields()) {
    if (f === 1) {
      for (const [tf, , tv] of reader(v).fields()) {
        if (tf === 1) tripId = text.decode(tv);
        else if (tf === 5) routeId = text.decode(tv);
      }
    } else if (f === 2) stops.push(stopTimeUpdate(v));
  }
  return { routeId, tripId, stops };
}

// Returns [{ routeId, tripId, stopId, time }] — one row per upcoming stop on every trip.
export function decodeArrivals(arrayBuffer) {
  const buf = new Uint8Array(arrayBuffer);
  const rows = [];
  for (const [f, , entity] of reader(buf).fields()) {
    if (f !== 2) continue;
    for (const [ef, , ev] of reader(entity).fields()) {
      if (ef !== 3) continue;
      const tu = tripUpdate(ev);
      for (const s of tu.stops) {
        if (s.stopId && s.time) rows.push({ routeId: tu.routeId, tripId: tu.tripId, stopId: s.stopId, time: s.time });
      }
    }
  }
  return rows;
}
