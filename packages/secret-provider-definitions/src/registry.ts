import { makeSecretProviderDefinitionRegistry } from "@murmur/secret-provider-core/shared/definition";
import * as OnePassword from "@murmur/secret-provider-onepassword/shared/definition";

export const builtInSecretProviderDefinitions = makeSecretProviderDefinitionRegistry([
  OnePassword.definition,
]);
