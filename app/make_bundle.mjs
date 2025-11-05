import fs from 'fs'
import path from 'path'
import archiver from 'archiver'
import { fileURLToPath } from 'url'
import pathLib from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = pathLib.dirname(fileURLToPath(import.meta.url))

// AI2Apps 项目根目录
const AI2APPS_ROOT = path.join(__dirname, '../../ai2apps')

/*
Pack srcDir's contents into zip and save into file:zipPath.
- Keep: file's attributes like execution
- Ignore:
1) dir named as: "node_modules","temp","tmp"
2) file with zero size
* */
function zipDir (srcDir, zipPath) {
	/*
	let pms,callback,callerror;
	pms=new Promise((resolve,reject)=>{
		callback=resolve;
		callerror=reject;
	});
	*/
	
	// Create a file to stream archive data to
	const output = fs.createWriteStream(zipPath)
	const archive = archiver('zip', {
		zlib: { level: 9 } // Sets the compression level
	})
	
	// Listen for all archive data to be written
	output.on('close', function () {
		console.log(`Archive created: ${archive.pointer()} total bytes`)
	})
	
	// Handle warnings and errors
	archive.on('warning', function (err) {
		if (err.code === 'ENOENT') {
			console.warn('Warning:', err)
		} else {
			throw err
		}
	})
	
	archive.on('error', function (err) {
		throw err
	})
	
	// Pipe archive data to the file
	archive.pipe(output)
	
	// Function to recursively add files to the archive
	let entryCount=0;
	function addToArchive (currentPath, relativePath = '') {
		const stats = fs.statSync(currentPath)
		
		if (stats.isDirectory()) {
			const dirName = path.basename(currentPath)
			
			// Skip directories to ignore
			if (['node_modules', 'temp', 'tmp'].includes(dirName)) {
				return
			}
			
			const files = fs.readdirSync(currentPath)
			
			if(files.length===0) {
				// Add empty directory
				console.log(`Archiving empty directory: ${currentPath}`)
				archive.append('', { name: path.join(relativePath, '/') })
			} else {
				files.forEach(file => {
					const filePath = path.join(currentPath, file)
					const fileRelativePath = path.join(relativePath, file)
					addToArchive(filePath, fileRelativePath)
				})
			}
		} else if (stats.isFile()) {
			// Skip empty files
			if (stats.size === 0) {
				return
			}
			// console.log(`Archiving: ${currentPath}`)
			entryCount++;
			
			// Add file to archive with its mode (permissions) preserved
			archive.file(currentPath, {
				name: relativePath,
				mode: stats.mode // Preserve file permissions
			})
		}
	}
	
	// Start the archiving process
	addToArchive(srcDir)
	console.log(`Total files added to archive: ${entryCount}`)
	
	// Finalize the archive
	archive.finalize()
}


function copyDirSync(srcDir, destDir) {
	if (!fs.existsSync(destDir)) {
		fs.mkdirSync(destDir, { recursive: true });
	}

	const entries = fs.readdirSync(srcDir, { withFileTypes: true });
	for (const entry of entries) {
		const srcPath = path.join(srcDir, entry.name);
		const destPath = path.join(destDir, entry.name);
		if (entry.isDirectory()) {
			const dirName = path.basename(srcPath);
			// Skip directories to ignore
			if (['node_modules', 'temp', 'tmp', '.git'].includes(dirName)) {
				continue;
			}

			copyDirSync(srcPath, destPath);
		} else {
			fs.copyFileSync(srcPath, destPath);
		}
	}
}

function main() {
	const args = process.argv.slice(2);
	console.log('Args:',args);
	const sync = args.includes('--sync');
	if(sync){
		console.log('Start copy to bundle_data')
		if(!fs.existsSync(AI2APPS_ROOT)) {
			console.error(`${AI2APPS_ROOT} 不存在，请设置正确的项目路径`)

			return;
		}
		copyDirSync(
			AI2APPS_ROOT,
			path.join(__dirname, '../bundle_data')
		);

		fs.copyFile(
			path.join(__dirname, '../local/.env'),
			path.join(__dirname, '../bundle_data/.env'),
			(err)=>{if(err){console.log("Copy .env error: "+err);}}
		);
	}

	console.log('Start zip bundle')
	zipDir(path.join(__dirname, '../bundle_data'), path.join(__dirname, '../bundle/bundle.zip'))
	console.log('Copy package.json');
	fs.copyFile(
		path.join(__dirname, '../local/package.json'),
		path.join(__dirname, '../bundle/package.json'),
		(err)=>{if(err){console.log("Copy package.json error: "+err);}}
	);
	console.log('Update bundle version');
	{
		let bundlePath=path.join(__dirname, '../bundle/bundle.json');
		const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
		bundle.build = (bundle.build || 0) + 1;
		fs.writeFileSync(bundlePath, JSON.stringify(bundle, null, 2));
	}
}

main();
