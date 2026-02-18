// deno-coverage-ignore-file

import { Inject, Injectable, Tags } from "./decorators.ts";
import type { ModuleRef } from "./module_ref.ts";

@Injectable()
export class SimpleService {
  public value = "simple";
}

@Injectable()
export class DependentService {
  @Inject(SimpleService)
  public simple!: SimpleService;
}

@Injectable({ mode: "transient" })
export class TransientService {
  public id = crypto.randomUUID();
}

@Injectable({ mode: "request" })
export class RequestScopedService {
  public id = crypto.randomUUID();
}

@Injectable()
export class ServiceWithOptionalDep {
  @Inject("OPTIONAL_TOKEN", { optional: true })
  public optional?: string;
}

export const TAG_A = Symbol("TAG_A");
export const TAG_B = "tag_b";

@Injectable()
@Tags(TAG_A, TAG_B)
export class TaggedServiceA {
  public name = "A";
}

@Injectable()
@Tags(TAG_A)
export class TaggedServiceB {
  public name = "B";
}

@Injectable()
export class ServiceWithModuleRef {
  constructor(public moduleRef: ModuleRef) {}
}
