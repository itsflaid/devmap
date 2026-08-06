"use client";

import { useState, useEffect } from "react";

export function TodoList() {
  const [todos, setTodos] = useState([]);

  useEffect(() => {
    fetch("/api/todos")
      .then((res) => res.json())
      .then(setTodos);
  }, []);

  return (
    <ul>
      {todos.map((todo: any) => (
        <li key={todo.id}>{todo.title}</li>
      ))}
    </ul>
  );
}
