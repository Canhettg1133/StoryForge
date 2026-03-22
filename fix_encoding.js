const fs = require('fs');
const filepath = 'e:/StoryForge/src/components/common/ChapterList.jsx';
let content = fs.readFileSync(filepath, 'utf8');

content = content.replace(/Ä á»•i tĂªn/g, 'Đổi tên');

fs.writeFileSync(filepath, content, 'utf8');
console.log('Fixed Ä á»•i tĂªn -> Đổi tên');
