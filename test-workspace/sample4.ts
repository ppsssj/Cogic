class WithoutInnerClass {
  greet(name: string): string {
    const message = `Hello, ${name}`;
    return message.toUpperCase();
  }
}
class WithInnerClassLikePattern {
  createWorker(prefix: string) {
    class Worker {
      constructor(private id: number) {}

      run(task: string) {
        return `${prefix}-${this.id}:${task}`;
      }
    }

    const worker = new Worker(1);
    return worker.run("build");
  }
}
