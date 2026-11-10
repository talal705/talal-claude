// JavaScript that runs INSIDE the sandbox: the frame's bootstrap and the workers it starts.
// It is kept as plain text because it never runs in the application: the page hands it to a frame
// with an opaque origin, which loads it from a blob URL. The application's bundler does not see it.
// Keep it dependency-free, and conservative in syntax.

/**
 * Bootstrap of a frame that hosts one worker. It waits for the page's connect message (which must
 * come from the parent window and carry this frame's nonce), starts the worker from the source it
 * was given, and relays the worker's messages to the page over the private port.
 */
export function workerFrameBootstrap(nonce: string): string {
  return `(function () {
  var NONCE = ${JSON.stringify(nonce)};
  function onConnect(event) {
    var data = event.data;
    if (event.source !== window.parent || !data || data.nonce !== NONCE || !event.ports || !event.ports[0]) return;
    window.removeEventListener("message", onConnect);
    var port = event.ports[0];
    function fail(message) {
      port.postMessage({ ytl: 1, executionId: data.executionId, type: "error", name: "Error", message: message, stack: "" });
      port.postMessage({ ytl: 1, executionId: data.executionId, type: "done", exitCode: 1 });
    }
    try {
      var url = URL.createObjectURL(new Blob([data.workerSource], { type: "text/javascript" }));
      var worker = new Worker(url, { type: data.workerType });
      worker.onmessage = function (e) { port.postMessage(e.data); };
      worker.onerror = function (e) {
        if (e.preventDefault) e.preventDefault();
        fail(String(e.message || "The program could not be started."));
      };
      worker.postMessage(data.init);
    } catch (error) {
      fail(String(error && error.message ? error.message : error));
    }
  }
  window.addEventListener("message", onConnect);
})();`;
}

// Shared by the worker and the preview page: turns console arguments into one line of text.
const FORMAT_SOURCE = `
function ytlFormat(value, depth, seen) {
  if (typeof value === "string") return depth ? JSON.stringify(value) : value;
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "[Function" + (value.name ? ": " + value.name : "") + "]";
  if (value instanceof Error) return value.stack && !depth ? ytlCleanStack(value) : (value.name + ": " + value.message);
  if (seen.indexOf(value) !== -1) return "[Circular]";
  if (depth >= 4) return Array.isArray(value) ? "[Array]" : "[Object]";
  seen = seen.concat([value]);
  try {
    if (Array.isArray(value)) {
      return "[" + value.slice(0, 100).map(function (item) { return ytlFormat(item, depth + 1, seen); }).join(", ") + (value.length > 100 ? ", ... " + (value.length - 100) + " more" : "") + "]";
    }
    if (value instanceof Map) return "Map(" + value.size + ") " + ytlFormat(Array.from(value.entries()).slice(0, 100), depth + 1, seen);
    if (value instanceof Set) return "Set(" + value.size + ") " + ytlFormat(Array.from(value.values()).slice(0, 100), depth + 1, seen);
    if (value instanceof Date) return isNaN(value.getTime()) ? "Invalid Date" : value.toISOString();
    if (value instanceof RegExp) return String(value);
    var keys = Object.keys(value);
    var name = value.constructor && value.constructor.name && value.constructor.name !== "Object" ? value.constructor.name + " " : "";
    if (keys.length === 0) return name + "{}";
    return name + "{ " + keys.slice(0, 100).map(function (key) { return key + ": " + ytlFormat(value[key], depth + 1, seen); }).join(", ") + (keys.length > 100 ? ", ..." : "") + " }";
  } catch (error) {
    return "[Unprintable]";
  }
}
function ytlFormatArgs(args) {
  var parts = [];
  for (var i = 0; i < args.length; i++) parts.push(ytlFormat(args[i], 0, []));
  return parts.join(" ");
}
`;

/**
 * Worker for JavaScript console programs (and the JavaScript emitted for TypeScript). A classic
 * worker: it links the planned modules into blob URLs, then loads the entry module with import().
 *
 * init: { executionId, modules: [{ path, chunks }], entry, stdin }
 */
export const JS_WORKER_SOURCE = `"use strict";
${FORMAT_SOURCE}
var ytlNames = {};
function ytlCleanStack(error) {
  var stack = String(error && error.stack ? error.stack : "");
  for (var url in ytlNames) stack = stack.split(url).join("project:/" + ytlNames[url]);
  return stack;
}
self.onmessage = function (event) {
  self.onmessage = null;
  var init = event.data;
  var finished = false;
  function send(message) {
    message.ytl = 1;
    message.executionId = init.executionId;
    self.postMessage(message);
  }
  function done(exitCode) {
    if (finished) return;
    finished = true;
    send({ type: "done", exitCode: exitCode });
  }
  function fail(reason) {
    if (finished) return;
    var isError = reason instanceof Error;
    send({
      type: "error",
      name: isError ? String(reason.name) : "",
      message: isError ? String(reason.message) : ytlFormat(reason, 0, []),
      stack: isError ? ytlCleanStack(reason) : ""
    });
    done(1);
  }

  var streams = { log: "stdout", info: "stdout", debug: "stdout", warn: "stderr", error: "stderr", trace: "stderr" };
  Object.keys(streams).forEach(function (method) {
    console[method] = function () {
      send({ type: "output", stream: streams[method], text: ytlFormatArgs(arguments) + "\\n" });
    };
  });
  console.assert = function (condition) {
    if (!condition) console.error.apply(console, ["Assertion failed:"].concat(Array.prototype.slice.call(arguments, 1)));
  };
  console.table = console.log;
  console.dir = console.log;

  // stdin is given in full before the program starts. readLine() returns the next line, or null at the end.
  var lines = init.stdin === "" ? [] : init.stdin.split("\\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  var nextLine = 0;
  self.readLine = function () {
    return nextLine < lines.length ? lines[nextLine++].replace(/\\r$/, "") : null;
  };

  // The program has ended when its entry module has run and no timer is still waiting.
  var pending = 0;
  var entryDone = false;
  function settle() {
    if (entryDone && pending === 0) done(0);
  }
  var nativeSetTimeout = self.setTimeout, nativeClearTimeout = self.clearTimeout;
  var nativeSetInterval = self.setInterval, nativeClearInterval = self.clearInterval;
  var live = {};
  self.setTimeout = function (callback, delay) {
    var args = Array.prototype.slice.call(arguments, 2);
    pending++;
    var id = nativeSetTimeout(function () {
      delete live[id];
      try {
        if (typeof callback === "function") callback.apply(self, args);
      } finally {
        pending--;
        nativeSetTimeout(settle, 0);
      }
    }, delay);
    live[id] = true;
    return id;
  };
  self.setInterval = function (callback, delay) {
    var args = Array.prototype.slice.call(arguments, 2);
    pending++;
    var id = nativeSetInterval(function () {
      if (typeof callback === "function") callback.apply(self, args);
    }, delay);
    live[id] = true;
    return id;
  };
  self.clearTimeout = self.clearInterval = function (id) {
    if (live[id]) {
      delete live[id];
      pending--;
      nativeSetTimeout(settle, 0);
    }
    nativeClearTimeout(id);
    nativeClearInterval(id);
  };

  self.addEventListener("error", function (e) {
    if (e.preventDefault) e.preventDefault();
    fail(e.error !== undefined && e.error !== null ? e.error : new Error(String(e.message)));
  });
  self.addEventListener("unhandledrejection", function (e) {
    if (e.preventDefault) e.preventDefault();
    fail(e.reason);
  });

  var urls = {};
  try {
    init.modules.forEach(function (module) {
      var source = module.chunks.map(function (chunk) {
        return typeof chunk === "string" ? chunk : JSON.stringify(urls[chunk.dep]);
      }).join("");
      var url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
      urls[module.path] = url;
      ytlNames[url] = module.path;
    });
  } catch (error) {
    fail(error);
    return;
  }

  send({ type: "ready" });
  import(urls[init.entry]).then(function () {
    entryDone = true;
    settle();
  }, fail);
};
`;

/** Runs the entry file as `__main__` and prints a traceback that names only the project's files. */
const PYTHON_RUNNER = `
import runpy, sys, traceback

def __ytl_run(entry):
    sys.argv = [entry]
    try:
        runpy.run_path(entry, run_name="__main__")
        return 0
    except SystemExit as exit:
        if exit.code is None:
            return 0
        if isinstance(exit.code, int):
            return exit.code
        print(exit.code, file=sys.stderr)
        return 1
    except BaseException as error:
        frames = [frame for frame in traceback.extract_tb(error.__traceback__) if frame.filename.startswith("/project/")]
        if frames:
            sys.stderr.write("Traceback (most recent call last):\\n")
            sys.stderr.write("".join(traceback.format_list(frames)))
        sys.stderr.write("".join(traceback.format_exception_only(type(error), error)))
        return 1
    finally:
        sys.stdout.flush()
        sys.stderr.flush()

__ytl_run(__ytl_entry)
`;

/**
 * Runs a project on a loaded Pyodide instance: stdin, output streams, files, entry file.
 * Separate from the worker below so it can be tested on Pyodide under Node.
 * Calls `send` with protocol messages (without the envelope) and resolves with the exit code.
 */
export const PYTHON_CORE_SOURCE = `
function ytlRunPython(pyodide, init, send) {
  var NEWLINE = String.fromCharCode(10), RETURN = String.fromCharCode(13);
  var lines = init.stdin === "" ? [] : init.stdin.split(NEWLINE);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  var nextLine = 0;
  function writer(stream) {
    var decoder = new TextDecoder();
    return {
      write: function (bytes) {
        var text = decoder.decode(bytes, { stream: true });
        if (text) send({ type: "output", stream: stream, text: text });
        return bytes.length;
      }
    };
  }
  // input() reads the next line of the stdin given up front; at the end it raises EOFError.
  pyodide.setStdin({
    stdin: function () {
      if (nextLine >= lines.length) return null;
      var line = lines[nextLine++];
      return line.charAt(line.length - 1) === RETURN ? line.slice(0, -1) : line;
    }
  });
  pyodide.setStdout(writer("stdout"));
  pyodide.setStderr(writer("stderr"));
  init.files.forEach(function (file) {
    var path = "/project/" + file.path;
    pyodide.FS.mkdirTree(path.slice(0, path.lastIndexOf("/")));
    pyodide.FS.writeFile(path, file.content);
  });
  pyodide.FS.chdir("/project");
  pyodide.globals.set("__ytl_entry", "/project/" + init.entry);
  send({ type: "ready" });
  return pyodide.runPythonAsync(${JSON.stringify(PYTHON_RUNNER)}).then(function (exitCode) {
    return typeof exitCode === "number" ? exitCode : 0;
  });
}
`;

/**
 * Worker for Python. A classic worker: it loads Pyodide from the application's own origin
 * (`assetBase`, e.g. https://host/runtime/pyodide/) and runs the project on it.
 *
 * init: { executionId, assetBase, files: [{ path, content }], entry, stdin }
 */
export const PYTHON_WORKER_SOURCE = `"use strict";
${PYTHON_CORE_SOURCE}
self.onmessage = function (event) {
  self.onmessage = null;
  var init = event.data;
  function send(message) {
    message.ytl = 1;
    message.executionId = init.executionId;
    self.postMessage(message);
  }
  send({ type: "loading", loading: true });
  Promise.resolve()
    .then(function () {
      importScripts(init.assetBase + "pyodide.js");
      return self.loadPyodide({ indexURL: init.assetBase });
    })
    .then(function (pyodide) {
      send({ type: "loading", loading: false });
      return ytlRunPython(pyodide, init, send);
    })
    .then(function (exitCode) {
      send({ type: "done", exitCode: exitCode });
    })
    .catch(function (error) {
      send({ type: "loading", loading: false });
      send({ type: "error", name: String(error && error.name ? error.name : "Error"), message: String(error && error.message ? error.message : error), stack: "" });
      send({ type: "done", exitCode: 1 });
    });
};
`;

/**
 * Script placed first in a preview page. It reports console output and errors to the application
 * over the private port, replaces dialogs (browsers block them in sandboxed frames) and stops the
 * page from navigating away from the preview.
 */
export function previewBootstrap(nonce: string): string {
  return `(function () {
  var NONCE = ${JSON.stringify(nonce)};
  ${FORMAT_SOURCE}
  function ytlCleanStack(error) { return String(error && error.stack ? error.stack : ""); }
  var port = null, executionId = null, queue = [];
  function send(message) {
    if (!port) { if (queue.length < 1000) queue.push(message); return; }
    message.ytl = 1;
    message.executionId = executionId;
    port.postMessage(message);
  }
  function onConnect(event) {
    var data = event.data;
    if (event.source !== window.parent || !data || data.nonce !== NONCE || !event.ports || !event.ports[0]) return;
    window.removeEventListener("message", onConnect);
    port = event.ports[0];
    executionId = data.executionId;
    port.onmessage = onWorkspaceMessage;
    send({ type: "ready" });
    queue.splice(0).forEach(send);
  }
  window.addEventListener("message", onConnect);

  // "How websites work": fetch() reaches only the training API, through the workspace. Every other
  // address fails here, before anything is sent (the page's policy would block it anyway).
  var pending = {}, nextRequest = 1;
  function onWorkspaceMessage(event) {
    var data = event.data;
    if (!data || data.ytl !== 1 || data.executionId !== executionId || typeof data.requestId !== "number") return;
    var waiting = pending[data.requestId];
    if (!waiting) return;
    delete pending[data.requestId];
    if (data.type === "api_response" && typeof data.status === "number" && typeof data.body === "string") {
      waiting.resolve(new Response(data.body, { status: data.status, headers: { "content-type": "application/json" } }));
    } else {
      waiting.reject(new TypeError(typeof data.message === "string" ? data.message : "The training API did not answer."));
    }
  }
  function trainingPath(target) {
    try {
      var base = new URL(document.baseURI);
      var url = new URL(target, base);
      if (url.origin !== base.origin || url.search !== "" || url.hash !== "" || url.pathname.indexOf("/api/") !== 0) return null;
      return url.pathname;
    } catch (error) {
      return null;
    }
  }
  window.fetch = function (input, init) {
    var target = typeof input === "string" ? input : input && typeof input.url === "string" ? input.url : String(input);
    var method = String((init && init.method) || (input && typeof input === "object" && input.method) || "GET").toUpperCase();
    var path = trainingPath(target);
    if (path === null) {
      send({ type: "api_blocked", url: String(target).slice(0, 500) });
      return Promise.reject(new TypeError("The preview can only reach this project's training API (paths that start with /api/)."));
    }
    var body = init && init.body !== undefined && init.body !== null ? init.body : null;
    if (body !== null && typeof body !== "string") {
      return Promise.reject(new TypeError("Send the body as text, for example JSON.stringify({ title: \"...\" })."));
    }
    return new Promise(function (resolve, reject) {
      var requestId = nextRequest++;
      pending[requestId] = { resolve: resolve, reject: reject };
      send({ type: "api_request", requestId: requestId, method: method, path: path, body: body });
    });
  };

  var streams = { log: "stdout", info: "stdout", debug: "stdout", warn: "stderr", error: "stderr", trace: "stderr" };
  Object.keys(streams).forEach(function (method) {
    console[method] = function () {
      send({ type: "output", stream: streams[method], text: ytlFormatArgs(arguments) + "\\n" });
    };
  });
  console.table = console.log;
  console.dir = console.log;

  function report(reason) {
    var isError = reason instanceof Error;
    send({ type: "error", name: isError ? String(reason.name) : "", message: isError ? String(reason.message) : ytlFormat(reason, 0, []), stack: "" });
  }
  window.addEventListener("error", function (e) {
    if (e.error !== undefined && e.error !== null) report(e.error);
    else if (e.message) send({ type: "error", name: "", message: String(e.message), stack: "" });
  });
  window.addEventListener("unhandledrejection", function (e) { report(e.reason); });

  window.alert = function (text) { console.log("alert: " + String(text)); };
  window.confirm = function (text) { console.log("confirm: " + String(text) + " (answered: OK)"); return true; };
  window.prompt = function (text, fallback) { console.log("prompt: " + String(text) + " (dialogs are not available in the preview)"); return fallback === undefined ? null : fallback; };

  // After the page's own handlers: a click or submit the page handled itself is left alone.
  window.addEventListener("click", function (e) {
    if (e.defaultPrevented) return;
    var node = e.target;
    while (node && node.nodeName !== "A" && node.nodeName !== "AREA") node = node.parentNode;
    if (!node || !node.getAttribute) return;
    var href = node.getAttribute("href");
    if (href === null || href.charAt(0) === "#") return;
    e.preventDefault();
    console.warn("Links to other pages do not open in the preview: " + href);
  });
  window.addEventListener("submit", function (e) {
    if (e.defaultPrevented) return;
    e.preventDefault();
    console.warn("Forms are not sent anywhere in the preview.");
  });
})();`;
}
