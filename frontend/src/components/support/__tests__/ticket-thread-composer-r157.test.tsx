/**
 * R157-IMPL-B #9 — the support reply composer's textarea contract.
 *
 * The composer was a single-line Input (maxLength 4000 made no sense on
 * one line). It is now an auto-growing <textarea>:
 *
 *   1. Enter still submits (the existing keydown contract), Shift+Enter
 *      stays a non-submit (the native newline);
 *   2. the a11y/cap trio the R137 pin freezes survives the swap
 *      (aria-label + enterKeyHint + maxLength);
 *   3. the box resizes to its content — including the page-owned draft
 *      clear after a successful send (the inline ref callback re-fires
 *      on every commit), not just user keystrokes.
 *
 * R158-IMPL-D (ledger a): extended with the closed-ticket inline CTA —
 * the thread's closed notice now carries a real «تذكرة جديدة» Button
 * wired through the page-owned onNewTicket callback (the R157-IMPL-B
 * #10 follow-up: the text-only hint was a dead end, and the wouter
 * same-route /support Link was refused as provably dead).
 *
 * jsdom has no layout, so scrollHeight is stubbed with a value-aware
 * getter for the resize assertions.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RefObject } from "react";
import { TicketThread } from "@/components/support/TicketThread";

const OPEN_TICKET = {
  id: 1,
  title: "مشكلة في الطلب",
  status: "open",
  category: "order",
  created_at: new Date().toISOString(),
  replies: [
    {
      id: 11,
      author_type: "user",
      message: "لم أستلم بيانات الحساب",
      created_at: new Date().toISOString(),
    },
  ],
};

function mount(replyText: string, onReply: (e: React.FormEvent) => void) {
  const utils = render(
    <TicketThread
      selectedTicket={OPEN_TICKET as never}
      ticketLoading={false}
      replyText={replyText}
      onReplyTextChange={vi.fn()}
      sending={false}
      onReply={onReply}
      messagesEndRef={{ current: null } as RefObject<HTMLDivElement | null>}
      onNewTicket={vi.fn()}
    />,
  );
  const composer = () => screen.getByLabelText("نص الرد على التذكرة") as HTMLTextAreaElement;
  return { ...utils, composer };
}

afterEach(cleanup);

describe("R157 #9 — the reply composer is a multi-line, auto-growing textarea", () => {
  it("Enter submits, Shift+Enter does not — the R94-A1 #3 contract survives the swap", () => {
    const onReply = vi.fn();
    const { composer } = mount("رد اختبار", onReply);

    const el = composer();
    expect(el.tagName).toBe("TEXTAREA");

    fireEvent.keyDown(el, { key: "Enter", shiftKey: true });
    expect(onReply).not.toHaveBeenCalled();

    fireEvent.keyDown(el, { key: "Enter" });
    expect(onReply).toHaveBeenCalledTimes(1);
  });

  it("the aria/cap trio the R137 pin freezes stays on the field", () => {
    const { composer } = mount("", vi.fn());
    const el = composer();
    expect(el.getAttribute("maxlength")).toBe("4000");
    expect(el.getAttribute("enterkeyhint")).toBe("send");
    expect(el).toHaveAttribute("dir", "rtl");
  });

  it("grows with the content and collapses when the page clears the draft", () => {
    const desc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "scrollHeight");
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      configurable: true,
      get(this: HTMLTextAreaElement) {
        // A value-aware stub: a draft >10 chars "needs" 123px, else 44px.
        return this.value.length > 10 ? 123 : 44;
      },
    });
    try {
      const onReply = vi.fn();
      const { composer, rerender } = mount("سطر أول و سطر ثانٍ طويل", onReply);
      expect(composer().style.height).toBe("123px");

      // The page clears the draft after a successful send — the box must
      // collapse on the re-render (the inline ref re-fires per commit).
      rerender(
        <TicketThread
          selectedTicket={OPEN_TICKET as never}
          ticketLoading={false}
          replyText=""
          onReplyTextChange={vi.fn()}
          sending={false}
          onReply={onReply}
          messagesEndRef={{ current: null } as RefObject<HTMLDivElement | null>}
          onNewTicket={vi.fn()}
        />,
      );
      expect(composer().style.height).toBe("44px");
    } finally {
      if (desc) Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", desc);
    }
  });
});

describe("R158-D ledger a — the closed notice carries a wired «تذكرة جديدة» CTA", () => {
  it("a closed ticket renders the notice CTA and it fires the page-owned onNewTicket callback", () => {
    const CLOSED_TICKET = {
      ...OPEN_TICKET,
      id: 2,
      status: "closed",
      replies: [],
    };
    const onNewTicket = vi.fn();
    render(
      <TicketThread
        selectedTicket={CLOSED_TICKET as never}
        ticketLoading={false}
        replyText=""
        onReplyTextChange={vi.fn()}
        sending={false}
        onReply={vi.fn()}
        messagesEndRef={{ current: null } as RefObject<HTMLDivElement | null>}
        onNewTicket={onNewTicket}
      />,
    );

    // The closed notice (not the reply composer) is on screen…
    expect(screen.getByText(/التذكرة مغلقة/)).toBeInTheDocument();
    expect(screen.queryByLabelText("نص الرد على التذكرة")).not.toBeInTheDocument();
    // …and inside it sits the CTA, which fires the callback once tapped.
    const cta = screen.getByRole("button", { name: "تذكرة جديدة" });
    fireEvent.click(cta);
    expect(onNewTicket).toHaveBeenCalledTimes(1);
  });
});
