class WithoutInnerClass {
  greet(name: string): string {
    const message = this.formatMessage(name);
    return message.toUpperCase();
  }

  private formatMessage(name: string): string {
    return `Hello, ${name}`;
  }
}

class WithInnerClassLikePattern {
  createWorker(prefix: string) {
    const createLabel = (task: string) => `${prefix}:${task}`;

    class Worker {
      constructor(private id: number) {}

      run(task: string) {
        return this.render(createLabel(task));
      }

      private render(label: string) {
        return `${label}-${this.id}`;
      }
    }

    const worker = new Worker(1);
    return worker.run("build");
  }
}

function executeGreetingFlow(input: string): string {
  const greeter = new WithoutInnerClass();
  return greeter.greet(input);
}

function executeWorkerFlow(prefix: string): string {
  function finalize(result: string) {
    return `[worker:${result}]`;
  }

  const pattern = new WithInnerClassLikePattern();
  const output = pattern.createWorker(prefix);
  return finalize(output);
}

function runAll(): void {
  const greetResult = executeGreetingFlow("Cogic");
  const workerResult = executeWorkerFlow("trace");

  console.log(greetResult);
  console.log(workerResult);
}

runAll();
