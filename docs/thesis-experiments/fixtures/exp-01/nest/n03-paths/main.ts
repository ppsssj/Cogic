import { Controller, Get, Patch, Put } from "@nestjs/common";

function load(id: string): string {
  return id;
}

@Controller("/items/")
export class ItemsController {
  @Get("/:id/")
  one(): string {
    return load("1");
  }

  @Put(":id")
  replace(): string {
    return load("2");
  }

  @Patch(":id")
  update(): string {
    return this.one();
  }
}

@Controller()
export class RootController {
  @Get()
  index(): string {
    return "root";
  }
}
