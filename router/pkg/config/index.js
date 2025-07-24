import $RefParser from "@apidevtools/json-schema-ref-parser"
import fs from'fs'


try {
  const data = fs.readFileSync("config.schema.json", 'utf8'); // read file as string
  const mySchema = JSON.parse(data);

  await $RefParser.dereference(mySchema);
  // note - by default, mySchema is modified in place, and the returned value is a reference to the same object
  // console.log(mySchema.definitions.person.properties.firstName);

  // // if you want to avoid modifying the original schema, you can disable the `mutateInputSchema` option
  // let clonedSchema = await $RefParser.dereference(mySchema, { mutateInputSchema: false });
  // console.log(clonedSchema.definitions.person.properties.firstName);

  // remove $defs property if it exists
  if (mySchema.$defs) {
    delete mySchema.$defs;
  }

  fs.writeFileSync("config.dereferenced.schema.json", JSON.stringify(mySchema, null, 2), 'utf8'); // write dereferenced schema to file

} catch (err) {
  console.error(err);
}