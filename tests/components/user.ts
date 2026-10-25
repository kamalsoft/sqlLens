// Minimal stand-in for @testing-library/user-event (not a dependency).
import { act, fireEvent } from "@testing-library/react";

const userEvent = {
  setup() {
    return {
      async type(el: Element, text: string) {
        const input = el as HTMLInputElement | HTMLTextAreaElement;
        await act(async () => {
          fireEvent.change(input, { target: { value: input.value + text } });
        });
      },
      async clear(el: Element) {
        await act(async () => {
          fireEvent.change(el, { target: { value: "" } });
        });
      },
      async click(el: Element) {
        await act(async () => {
          fireEvent.click(el);
        });
      },
    };
  },
};

export default userEvent;
