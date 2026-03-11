const fs = require('fs');
const path = require('path');

const dir = "C:\\Users\\32665\\Desktop\\test_yanzhi\\LLM\\文章";
try {
    const files = fs.readdirSync(dir);
    console.log(`Files in ${dir}:`);
    files.forEach(f => console.log(`- ${f}`));
} catch (e) {
    console.error(e.message);
}
