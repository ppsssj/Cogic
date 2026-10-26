import { useState } from "react";

export function TodoList() {
  const [items, setItems] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  function onInput(text: string) {
    setDraft(text);
    setError(null);
  }

  function onSubmit() {
    if (draft === "") {
      setError("empty");
      return;
    }
    setItems((prev) => [...prev, draft]);
    setDraft("");
  }

  function onClear() {
    setItems([]);
    setError(null);
  }

  return { items, onInput, onSubmit, onClear };
}
