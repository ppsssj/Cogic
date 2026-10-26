import { reactive, ref } from "vue";

export function useForm() {
  const name = ref("");
  const email = ref("");
  const errors = reactive({ name: "", email: "" });

  function setName(v: string) {
    name.value = v;
    errors.name = "";
  }

  function setEmail(v: string) {
    email.value = v;
    errors.email = "";
  }

  function validate(): boolean {
    errors.name = name.value === "" ? "required" : "";
    errors.email = email.value === "" ? "required" : "";
    return errors.name === "" && errors.email === "";
  }

  return { name, email, errors, setName, setEmail, validate };
}
