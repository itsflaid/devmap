import { getTodos } from "@/lib/todos";

export default async function TodosPage() {
  const todos = await getTodos();
  return (
    <ul>
      {todos.map((todo) => (
        <li key={todo.id}>{todo.title}</li>
      ))}
    </ul>
  );
}
