"use strict";

// ============================================================
// Кодек ссылки-шара схемы каскада: payload сжимается deflate-raw и
// кодируется base64url во фрагмент адреса (#s=…). Живёт отдельно от
// cascade-io.js, потому что такую ссылку формирует и одиночный расчёт
// (index.html, кнопка «В каскад»), а cascade-io.js на index не грузится.
// Формат ссылки — общий контракт страниц: разбор см. cascade-io.js
// (decodeShareCode) и README, раздел «Шаринг каскада ссылкой».
// ============================================================

const SHARE_PARAM = "s";
// Фрагмент не уходит на сервер, ограничение — строка адреса браузера;
// держим запас. Больше — предлагаем экспорт в файл.
const SHARE_LIMIT = 6000;

function bytesToB64url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlToBytes(code) {
  const bin = atob(code.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// d — deflate-raw (CompressionStream, Chrome 80+/FF 113+/Safari 16.4+);
// j — без сжатия, деградация для старых браузеров: ссылка длиннее, но живая.
// payload — уже подготовленный (strip дефолтов делает вызывающий).
async function encodeSharePayload(payload) {
  const json = JSON.stringify(payload);
  if (typeof CompressionStream === "function") {
    const stream = new Blob([json]).stream()
      .pipeThrough(new CompressionStream("deflate-raw"));
    return "d." + bytesToB64url(new Uint8Array(await new Response(stream).arrayBuffer()));
  }
  return "j." + bytesToB64url(new TextEncoder().encode(json));
}

async function decodeSharePayload(code) {
  let json;
  if (code.startsWith("d.")) {
    if (typeof DecompressionStream !== "function") {
      throw new Error("браузер не поддерживает сжатые ссылки");
    }
    const stream = new Blob([b64urlToBytes(code.slice(2))]).stream()
      .pipeThrough(new DecompressionStream("deflate-raw"));
    json = await new Response(stream).text();
  } else if (code.startsWith("j.")) {
    json = new TextDecoder().decode(b64urlToBytes(code.slice(2)));
  } else {
    throw new Error("неизвестный формат ссылки");
  }
  return JSON.parse(json);
}
