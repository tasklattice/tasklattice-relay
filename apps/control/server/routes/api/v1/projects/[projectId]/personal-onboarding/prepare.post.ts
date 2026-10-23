import { defineHandler } from "nitro";
import { handlePersonalOnboarding } from "../../../../../../projects/personal-onboarding-http";
export default defineHandler((event) => handlePersonalOnboarding(event.req, "prepare"));
