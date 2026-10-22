import React from "react";

export function Button({ id }: { id: string }) {
  const [count, setCount] = React.useState(0);
  return (
    <button id={id} onClick={() => setCount((value) => value + 1)}>
      {id}: {count}
    </button>
  );
}
