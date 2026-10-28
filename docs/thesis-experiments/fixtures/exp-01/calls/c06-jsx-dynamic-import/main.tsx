import { Card } from "./Card";

function Title(props: { text: string }) {
  return <h1>{props.text}</h1>;
}

export function Page() {
  return (
    <div>
      <Title text="hi" />
      <Card />
    </div>
  );
}

export async function loadSettings() {
  const mod = await import("./settings");
  return mod.defaults();
}
