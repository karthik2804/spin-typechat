import { HandleRequest, HttpRequest, HttpResponse, InferencingModels, Llm } from "@fermyon/spin-sdk"
import { Result, TypeChatLanguageModel } from "typechat"
import { Cart } from "./schema"

const decoder = new TextDecoder()

function createModel(): TypeChatLanguageModel {
  let model = {
    complete(prompt: string): Promise<Result<string>> {
      return Promise.resolve({
        success: true,
        data: Llm.infer(InferencingModels.Llama2Chat, prompt, { maxTokens: 250 }).text
      })
    }
  }
  return model
}

export const handleRequest: HandleRequest = async function (request: HttpRequest): Promise<HttpResponse> {

  let model = createModel()
  const schema = decoder.decode(await fsPromises.readFile("./src/schema.ts"))
  const translator = createJsonTranslator<Cart>(model, schema, "Cart")

  const response = await translator.translate(request.text())
  let body: string
  if (!response.success) {
    body = response.message
  } else {
    body = response.data
    console.log(response.data)
  }

  return {
    status: 200,
    headers: { "foo": "bar" },
    body: body
  }
}

function createJsonTranslator<T>(model: TypeChatLanguageModel, schema: string, typeName: any) {
  const validator = createValidator(schema, "Cart")
  const typeChat = {
    model,
    validator,
    attemptRepair: true,
    stripNulls: false,
    createRequestPrompt,
    createRepairPrompt,
    translate
  }
  return typeChat
  function createRequestPrompt(request: string) {
    return `You are a service that translates user requests into JSON objects of type "${validator.typeName}" according to the following TypeScript definitions:\n` +
      `\`\`\`\n${validator.schema}\`\`\`\n` +
      `The following is a user request:\n` +
      `"""\n${request}\n"""\n` +
      `The following is the user request translated into a JSON object with 2 spaces of indentation and no properties with the value undefined:\n`
  }
  function createRepairPrompt(validationError: string) {
    return `The JSON object is invalid for the following reason:\n` +
      `"""\n${validationError}\n"""\n` +
      `The following is a revised JSON object:\n`
  }
  async function translate(request: string): Promise<Result<string>> {
    let prompt = typeChat.createRequestPrompt(request)
    let attemptRepair = typeChat.attemptRepair
    while (true) {
      const response = await model.complete(prompt)
      if (!response.success) {
        return response
      }
      const responseText = response.data
      const startIndex = responseText.indexOf("{")
      const endIndex = responseText.lastIndexOf("}")
      if (!(startIndex >= 0 && endIndex > startIndex)) {
        return { success: false, message: `Response is not JSON:\n${responseText}` }
      }
      const jsonText = responseText.slice(startIndex, endIndex + 1)
      console.log(jsonText)
      const validation = validator.validate(jsonText)
      if (validation.success) {
        return { success: true, data: jsonText }
      }
      if (!attemptRepair) {
        return { success: false, message: `JSON validation failed: ${validation.message}\n${jsonText}` }
      }
      console.log("repairing")
      prompt += `${responseText}\n${typeChat.createRepairPrompt(validation.message)}`
      attemptRepair = false
    }
  }
}

function createValidator(schema: string, typeName: string) {
  return {
    typeName: typeName,
    schema: schema,
    validate(jsonText: string): Result<string> {
      let jsonObject
      try {
        jsonObject = JSON.parse(jsonText)
        return { success: true, data: jsonObject }
      }
      catch (e) {
        return { success: false, message: "JSON parse error" }
      }
    }
  }
}