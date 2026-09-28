const requiredMajor=24;
const currentMajor=Number(process.versions.node.split('.')[0]);
if(currentMajor!==requiredMajor){
  console.error(`Node ${requiredMajor}.x required; current ${process.versions.node}`);
  process.exit(1);
}
console.log(`Node runtime PASS: ${process.versions.node}`);
