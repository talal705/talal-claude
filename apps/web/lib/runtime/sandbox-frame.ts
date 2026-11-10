// Opens the isolated surface learner code runs in: an <iframe sandbox="allow-scripts"> filled from
// srcdoc. Without allow-same-origin the frame has an opaque origin, so code inside it has no access
// to this site's cookies, storage or authenticated API. The page talks to it over one MessageChannel
// created for that frame and that execution, and validates every message it receives.
import { parseSandboxMessage, type SandboxMessage } from "./protocol";

export interface SandboxOptions {
  executionId: string;
  /** From `newNonce()`. The frame's bootstrap script must embed the same value. */
  nonce: string;
  /** The frame's whole document. */
  srcdoc: string;
  /** Extra fields for the connect message (worker source, files). Sent once, to the first document only. */
  connect?: Record<string, unknown>;
  /** Where a visible frame goes. Without it the frame is hidden and attached to the document body. */
  container?: HTMLElement;
  title: string;
  onMessage: (message: SandboxMessage) => void;
  /** The frame loaded a second document: the page inside navigated away and the channel is gone. */
  onNavigated: () => void;
}

export interface Sandbox {
  /** Removes the frame. The browser then ends its scripts and every worker it started. */
  dispose(): void;
  /** Sends a message to the frame's document over the private channel (adds the envelope). Ignored before it connected. */
  send(message: Record<string, unknown>): void;
}

/** A fresh random value that ties one frame document to one connect message. */
export function newNonce(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Wraps a bootstrap script and optional content in a document whose first element is its
 * Content-Security-Policy, so the policy is in force before any other markup is parsed.
 */
export function sandboxDocument(csp: string, bootstrap: string, rest = ""): string {
  // "</script" inside the bootstrap text would end the element early.
  const script = bootstrap.replace(/<\/(script)/gi, "<\\/$1");
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp.replace(/"/g, "&quot;")}"><script>${script}</script></head><body>${rest}</body></html>`;
}

export function openSandbox(options: SandboxOptions): Sandbox {
  const { nonce } = options;
  const frame = document.createElement("iframe");
  // Set before the frame gets any content. Scripts only: no same-origin, forms, popups, top navigation or downloads.
  frame.setAttribute("sandbox", "allow-scripts");
  // No camera, microphone, location or other powerful feature.
  frame.setAttribute("allow", "");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.title = options.title;
  if (options.container) {
    frame.style.cssText = "display:block;width:100%;height:100%;border:0;background:#fff;";
  } else {
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText = "position:fixed;width:0;height:0;border:0;visibility:hidden;pointer-events:none;";
  }

  let channel: MessageChannel | null = null;
  let disposed = false;

  frame.addEventListener("load", () => {
    if (disposed) return;
    if (channel) {
      // Never hand a port, the files or anything else to a document we did not write.
      options.onNavigated();
      return;
    }
    const target = frame.contentWindow;
    if (!target) return;
    channel = new MessageChannel();
    channel.port1.onmessage = (event) => {
      if (disposed) return;
      const message = parseSandboxMessage(event.data, options.executionId);
      if (message) options.onMessage(message);
    };
    // The frame's origin is opaque, so "*" is the only target that reaches it. The message carries
    // nothing secret: the learner's own files, and a nonce that only this frame's document knows.
    target.postMessage({ ...options.connect, executionId: options.executionId, nonce }, "*", [channel.port2]);
  });

  frame.srcdoc = options.srcdoc;
  (options.container ?? document.body).appendChild(frame);

  return {
    send(message) {
      if (!disposed) channel?.port1.postMessage({ ...message, ytl: 1, executionId: options.executionId });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      channel?.port1.close();
      frame.remove();
    },
  };
}
