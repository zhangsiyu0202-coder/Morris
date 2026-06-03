import { Account, Client } from "appwrite";

export function appwriteClient(): Client {
  return new Client()
    .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT ?? "http://localhost:8080/v1")
    .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID ?? "");
}

export function account(): Account {
  return new Account(appwriteClient());
}
