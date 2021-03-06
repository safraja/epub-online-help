/*
Copyright (c) 2020 Jakub Šafránek
*/

// Default location of a file to open, if it is not specified in URL. If left empty,
// app will ask user to upload local file or insert URL address of EPUB file.
const EPUB_DEFAULT_FILE = ""; // example: https://akiba.cz/epub/test_epub.epub
// Specifies, if app should (after CACHE TIME) check, if EPUB was not changed.
const EPUB_CHECK_UPDATE = true;

window.db_name;
window.db = {};
window.epub_file;
window.secondary_epub_files = [];
window.readed_page;
window.page_hash;
window.epub_settings = {};


if (!window.indexedDB)
{
    window.alert("Je nám líto, váš prohlížeč nepodporuje stabilní verzi IndexDB, kterou tato aplikace vyžaduje.");
}

window.addEventListener('load', () =>
{
    Load_application();

    document.getElementById('file-upload-input').addEventListener('change', (event) =>
    {
        let files = event.target.files;
        if (files.length > 0)
        {
            window.db_name = 'LOCAL-FILE-' + files[0].name;
            Open_DB().then((result) =>
            {
                JSZip.loadAsync(files[0])
                    .then(function (zip)
                    {
                        return new Promise((resolve, reject) =>
                        {
                            document.getElementById('file-upload-div').style.display = 'none';
                            document.getElementById('epub-display').style.display = 'flex';
                            Process_inner_files(zip);
                            Add_listeners();
                        });
                    });
            });
        }
    });

    document.getElementById('confirm-file-addres-load').addEventListener('click', (event) =>
    {
        let file_addres = document.getElementById('file-addres-input').value;

        if (file_addres != "")
        {
            let sec_files = [];
            let sec_file_el = document.querySelectorAll('[data-name="sec-file-addres-input"]');
            for(let element of sec_file_el)
            {
                if(element.value !== "")
                {
                    sec_files.push(element.value);
                }
            }
            if(sec_files.length === 0)
            {
                history.replaceState({"page": null}, null, `?file=${file_addres}`);
            }
            else
            {
                history.replaceState({"page": null}, null,
                    `?file=${file_addres}&secondary_files=${sec_files.join(',')}`);
            }

            Load_application();
            document.getElementById('file-upload-div').style.display = 'none';
            document.getElementById('epub-display').style.display = 'flex';
        }
        else
        {
            alert('Nebyla vyplněna adreasa');
        }

    });

    document.getElementById('contact-tab').addEventListener('click', (event) =>
    {
        Display_tab('epub-display');
    });

    document.getElementById('index-tab').addEventListener('click', (event) =>
    {
        Display_tab('epub-display');
    });

    document.getElementById('settings-tab').addEventListener('click', (event) =>
    {
        Display_tab('settings-div');
    });

    document.getElementById('add-new-addres-button').addEventListener('click', (event) =>
    {
        let input = document.createElement('input');
        input.placeholder = 'Adresa sekundárního souboru';
        input.setAttribute('data-name', 'sec-file-addres-input')
        input.type = 'url';

        event.target.parentNode.insertBefore(input, event.target);
    });
});

window.addEventListener('popstate', function (event)
{
    Change_page(event.state.page, "", true, event.state.file);
});

/**
 * Starting function, depending on URL parameters and the value of EPUB_DEFAULT_FILE constant either starts
 * loading of EPUB file or displays inputs for inserting local EPUB file or an URL adress.
 */
function Load_application()
{
    const url_params = new URL(location.href).searchParams;

    epub_file = url_params.get('file');
    secondary_epub_files = url_params.get('secondary_files');
    readed_page = url_params.get('readed_page');
    page_hash = url_params.get('hash');

    if (epub_file == null)
    {
        if (window.EPUB_DEFAULT_FILE != "")
        {
            epub_file = EPUB_DEFAULT_FILE;
            window.db_name = epub_file;
        }
    }
    else
    {
        window.db_name = epub_file;
    }

    if (window.db_name != "")
    {
        if (window.secondary_epub_files != null)
        {
            window.secondary_epub_files = window.secondary_epub_files.split(',');
            window.secondary_epub_files.unshift(window.db_name);
        }

        let databeses_to_load = [];

        if (window.secondary_epub_files != null)
        {
            for (let i = 0; i < window.secondary_epub_files.length; i++)
            {
                databeses_to_load.push(Open_DB(window.secondary_epub_files[i]));
            }
        }
        else
        {
            databeses_to_load.push(Open_DB())
        }

        Promise.all(databeses_to_load).then((results) =>
        {
            let secondary_epubs = [];

            for (let i = 1; i < results.length; i++)    // Start from 1 to ignore main EPUB file.
            {
                secondary_epubs.push(Renew_DB_content(results[i], window.secondary_epub_files[i]));
            }

            Promise.all(secondary_epubs).then(() =>
            {
                if ((results[0] == true) && (EPUB_CHECK_UPDATE == true))
                {
                    Read_from_DB('HTTP_HEADERS').then((result) =>
                    {
                        let old_headers = JSON.parse(result.file_content);

                        let http_req = new XMLHttpRequest();
                        http_req.open('HEAD', window.db_name);
                        http_req.onreadystatechange = function ()
                        {
                            if (this.readyState == this.DONE)
                            {
                                if (new Date(this.getResponseHeader('last-modified')) > new Date(old_headers['last-modified']))
                                {   // If the file on server were changed, clear DB and download process file from server.
                                    Clear_data_from_DB();
                                    Process_epub();
                                }
                                else
                                {   // Use saved files in DB.
                                    Read_from_DB('META-INF/container.xml').then((result) =>
                                    {
                                        return new Promise((resolve, reject) =>
                                        {
                                            let parser = new DOMParser();
                                            let xml_doc = parser.parseFromString(result.file_content, "text/xml");

                                            let rootfile =
                                                xml_doc.querySelector("container rootfiles rootfile").getAttribute("full-path");

                                            let rootfile_name = rootfile.substring(rootfile.lastIndexOf("/") + 1);
                                            sessionStorage.setItem("rootfile_dir", rootfile.replace(rootfile_name, ""));
                                            sessionStorage.setItem("rootfile_name", rootfile_name);

                                            resolve(rootfile)
                                        }).then(function (rootfile)
                                        {
                                            Load_UI(rootfile);
                                            Add_listeners();
                                        });
                                    });
                                }
                            }
                        };
                        http_req.send();
                    });
                }
                else
                {
                    Process_epub();
                }
            });
        });
    }
    else    // No default file loaded.
    {
        document.getElementById('file-upload-div').style.display = 'block';
        document.getElementById('epub-display').style.display = 'none';
    }
}

/**
 * Function used to check and eventually initialize actualizatin of database for secondary EPUB files.
 * Is not used for the main EPUB file.
 *
 * @param {boolean} db_existed - Information, wheter the DB already existed (EPUB was already loaded in the past) or is newly created.
 * @param {string} db_name - The name of the database, which should be checked.
 * @returns {Promise<void>} - Empty Promise.
 */
function Renew_DB_content(db_existed, db_name)
{
    return new Promise(async (resolve, reject) =>
    {
        if ((db_existed == true) && (EPUB_CHECK_UPDATE == true))
        {
            Read_from_DB('HTTP_HEADERS', db_name).then((result) =>
            {
                let old_headers = JSON.parse(result.file_content);

                let http_req = new XMLHttpRequest();
                http_req.open('HEAD', db_name);
                http_req.onreadystatechange = function ()
                {
                    if (this.readyState == this.DONE)
                    {
                        if (new Date(this.getResponseHeader('last-modified')) > new Date(old_headers['last-modified']))
                        {   // If the file on server were changed, clear DB and download process file from server.
                            Clear_data_from_DB();

                            Process_epub(db_name, false).then(() =>
                            {
                                resolve();
                            });
                        }
                        else
                        {

                            resolve();
                        }
                    }
                };
                http_req.send();
            });
        }
        else
        {
            await Process_epub(db_name, false).then(() =>
            {
                resolve();
            });
            resolve();
        }
    });
}

/**
 * Loads and extract an EPUB file.
 *
 * @param {string} [epub_file] - The name of the processed EPUB file. Set to main EPUB file name by default.
 * @param {boolean} [add_listeners] - Wheter to add event listeners after processing, used for the main EPUB file.
 * @returns {Promise<void>} - Empty Promise.
 */
function Process_epub(epub_file = "", add_listeners = true)
{
    return new Promise((resolve, reject) =>
    {
        if (epub_file == "")
        {
            epub_file = window.epub_file;
        }

        fetch(epub_file) // Fetch the url.
            .then(function (response)
            {
                if (response.status === 200 || response.status === 0)
                {
                    let headers = {};
                    for (let headers_data of response.headers.entries())
                    {
                        headers[headers_data[0]] = headers_data[1];
                    }

                    Save_file_to_DB("HTTP_HEADERS", JSON.stringify(headers), epub_file);
                    return Promise.resolve(response.blob());
                }
                else
                {
                    return Promise.reject(new Error(response.statusText));  // Loading file error.
                }
            })
            .then(JSZip.loadAsync)  // Chain with the zip promise.
            .then(function (zip)
            {
                return new Promise(async (resolve, reject) =>
                {
                    await Process_inner_files(zip, epub_file);
                    resolve();
                });
            })
            .then(function ()
            {
                if (add_listeners == false)
                {
                    resolve();
                }
            })
            .catch((error) =>
            {
                alert('Je nám líto, soubor se nepodařilo stáhnout. Je pravděpodobně příliš velký, nebo' +
                    ' server neumožňuje jeho stažení přes Javasript.');
            });

        if (add_listeners == true)
        {
            Add_listeners();
        }
    });
}

/**
 * Calls Save_files_from_zip() all files in EPUB and then calls Load_UI(), if processed zip was the main EPUB.
 *
 * @param zip - Extracted zip (EPUB) data.
 * @param {string} db_name - The name of the database, which should be checked.  Set to main EPUB file name by default.
 * @returns {Promise<void>} - Empty Promise.
 */
async function Process_inner_files(zip, db_name = "")
{
    await zip.file(`META-INF/container.xml`).async("string").then(function (content)
    {
        return new Promise((resolve, reject) =>
        {
            let parser = new DOMParser();
            let xml_doc = parser.parseFromString(content, "text/xml");

            let rootfile =
                xml_doc.querySelector("container rootfiles rootfile").getAttribute("full-path");

            let rootfile_name = rootfile.substring(rootfile.lastIndexOf("/") + 1);
            sessionStorage.setItem("rootfile_dir", rootfile.replace(rootfile_name, ""));
            sessionStorage.setItem("rootfile_name", rootfile_name);

            resolve(rootfile)
        });
    })
        .then(function (rootfile)
        {
            return new Promise(async (resolve, reject) =>
            {
                await Save_files_from_zip(zip, db_name);
                resolve(rootfile);
            });
        })
        .then(function (rootfile)
        {
            if (db_name == "" || db_name == window.db_name)  // Only if processed file is the main EPUB.
            {
                Load_UI(rootfile);
            }
        });
}

/**
 * Saves all extracted files from EPUB to database. Determines the form of saved data based on file extension.
 *
 * @param zip - Extracted zip (EPUB) data.
 * @param {string} db_name - The name of the database, which should be checked.  Set to main EPUB file name by default.
 * @returns {Promise<void>} - Empty Promise.
 */
async function Save_files_from_zip(zip, db_name = "")
{
    async function Load_file_content(file, type)
    {
        await file[1].async(type).then(function (content)
        {
            Save_file_to_DB(file[0], content, db_name);
        });
    }

    for (const element of Object.entries(zip["files"]))
    {
        if (element[0].endsWith(".jpg") || element[0].endsWith(".jpeg")
            || element[0].endsWith(".png") || element[0].endsWith(".gif")
            || element[0].endsWith(".webp") || element[0].endsWith(".mp3")
            || element[0].endsWith(".mpeg"))
        {
            await Load_file_content(element, "base64");
        }
        else if (element[0].endsWith(".webm") || element[0].endsWith(".mp4"))
        {
            await Load_file_content(element, "blob");
        }
        else
        {
            await Load_file_content(element, "string");
        }
    }
}

/**
 *  Add event listeners related to the loaded EPUB file, for example to the next and previou control buttons.
 */
function Add_listeners()
{
    document.getElementById("next").addEventListener("click", () =>
    {
        let loaded_page = document.getElementById("page-name");

        let loaded_page_name = loaded_page.textContent;

        Read_from_DB(sessionStorage.getItem("rootfile_dir") +
            sessionStorage.getItem("rootfile_name"), window.db_name).then((result) =>
        {
            let parser = new DOMParser();
            let xml_doc = parser.parseFromString(result.file_content, "text/xml");

            loaded_page_name = loaded_page_name.replace(sessionStorage.getItem("rootfile_dir"), "");
            let lp_id = xml_doc.querySelector(`[href='${loaded_page_name}']`).getAttribute("id");
            let np_id = xml_doc.querySelector(`[idref='${lp_id}']`).nextElementSibling.getAttribute("idref");
            let np_href = xml_doc.getElementById(np_id).getAttribute("href");

            loaded_page.textContent = sessionStorage.getItem("rootfile_dir") + np_href;

            Change_page(np_href, sessionStorage.getItem("rootfile_dir") + sessionStorage.getItem("rootfile_name"));
        });
    });

    document.getElementById("prev").addEventListener("click", () =>
    {
        let loaded_page = document.getElementById("page-name");

        let loaded_page_name = loaded_page.textContent;

        Read_from_DB(sessionStorage.getItem("rootfile_dir") +
            sessionStorage.getItem("rootfile_name"), window.db_name).then((result) =>
        {
            let parser = new DOMParser();
            let xml_doc = parser.parseFromString(result.file_content, "text/xml");

            loaded_page_name = loaded_page_name.replace(sessionStorage.getItem("rootfile_dir"), "");
            let lp_id = xml_doc.querySelector(`[href='${loaded_page_name}']`).getAttribute("id");
            let pp_id = xml_doc.querySelector(`[idref='${lp_id}']`).previousElementSibling.getAttribute("idref");
            let pp_href = xml_doc.getElementById(pp_id).getAttribute("href");

            loaded_page.textContent = sessionStorage.getItem("rootfile_dir") + pp_href;

            Change_page(pp_href, sessionStorage.getItem("rootfile_dir") + sessionStorage.getItem("rootfile_name"));
        });
    });

    document.getElementById("epub-display").addEventListener("load", () =>
    {
        document.getElementById("epub-display").contentDocument.addEventListener('click', function (event)
        {
            if (event.target.matches(`a[href]`))
            {
                let test_string = event.target.getAttribute("href").toLowerCase();
                if (!test_string.includes("https://") && !test_string.includes("http://")) // If link is not external.
                {
                    event.preventDefault();
                    Change_page(event.target.getAttribute("href"));
                }
            }
        });

        document.getElementById("epub-display").contentDocument.querySelectorAll('pre code').forEach((block) =>
        {
            hljs.highlightBlock(block);
        });

        let videos = document.getElementById("epub-display").contentDocument.querySelectorAll(`video`);

        for (let video of videos)
        {
            let source = video.querySelector('source');

            let test_string = source.getAttribute("src").toLowerCase();
            if (!test_string.includes("https") && !test_string.includes("http")) // If link is not external.
            {
                let changed_string = test_string.replace("../", "");    //  TO DO
                changed_string = changed_string.replace("./", "");

                Read_from_DB(`${sessionStorage.getItem("rootfile_dir")}${changed_string}`).then((result) =>
                {
                    video.src = window.URL.createObjectURL(result.file_content);
                });
            }
        }

        if (sessionStorage.getItem("cur_hash") != "")
        {
            let focused = document.getElementById("epub-display").contentDocument.body.querySelector(sessionStorage.getItem("cur_hash"));
            if (focused != null)
            {
                focused.scrollIntoView(true);
            }
        }
    });
}

/**
 * Load user interface of application based on main EPUB data.
 *
 * @param {string} rootfile - Rootfile name of the main EPUB file.
 * @returns {Promise<void>} - Empty Promise.
 */
function Load_UI(rootfile)
{
    return new Promise(() =>
    {
        if (page_hash != null)
        {
            sessionStorage.setItem("cur_hash", `#${page_hash}`);
        }

        let parser = new DOMParser();
        Read_from_DB(rootfile).then((rootfile_content) =>
        {
            let xml_doc = parser.parseFromString(rootfile_content.file_content, "text/xml");

            let documents_el = xml_doc.querySelectorAll(`manifest item`);
            let document_types = {};

            for (let doc of documents_el)
            {
                document_types[`${sessionStorage.getItem("rootfile_dir")}${doc.getAttribute("href")}`] =
                    doc.getAttribute("media-type");
            }

            sessionStorage.setItem("document_types", JSON.stringify(document_types));

            let epub_version = parseFloat(xml_doc.querySelector(`package`).getAttribute('version'));
            if (epub_version < 3)
            {
                alert('Varování, načítaný EPUB není ve verzi 3, některé funkce nemusí správně fungovat.');
            }

            let alt_lang_el = xml_doc.querySelectorAll('link[rel="alternate"][media-type="application/epub+zip"]');
            if (alt_lang_el.length > 0)
            {
                let main_language = xml_doc.getElementsByTagName('dc:language')[0].textContent.toUpperCase();

                let active_lang = document.querySelector('#language-select .active');
                active_lang.textContent = main_language;
                active_lang.addEventListener('click', (event) =>
                {
                    document.querySelector('#language-select .open').style.display = 'block';

                    let funct = function (event)
                    {
                        if (!(document.querySelector('#language-select').contains(event.target)))  //pokud není kliknuto do menu
                        {
                            document.querySelector('#language-select .open').style.display = 'none';
                            document.removeEventListener('click', funct);
                        }
                    };

                    document.body.addEventListener('click', funct);
                });

                let lang_list = document.querySelector('#language-select .open ul');
                let li = document.createElement('li');
                li.textContent = main_language;
                li.addEventListener('click', (event) =>
                {
                    document.querySelector('#language-select .open').style.display = 'none';
                });
                lang_list.appendChild(li);

                for (let lang of alt_lang_el)
                {
                    li = document.createElement('li');
                    let a = document.createElement('a');
                    a.textContent = lang.getAttribute('hreflang').toUpperCase();
                    let complete_href = location.protocol + '//' + location.hostname + location.pathname
                        + '?file=' + lang.getAttribute('href');
                    a.setAttribute('href', complete_href);
                    li.appendChild(a);
                    lang_list.appendChild(li);
                }
            }
            else
            {
                document.getElementById('language-select').style.display = 'none';
            }

            let settings_link = xml_doc.querySelector(`[rel='help:settings']`);
            if (settings_link != null)
            {
                let settings_href = settings_link.getAttribute('href');
                Read_from_DB(`${sessionStorage.getItem("rootfile_dir")}${settings_href}`)
                    .then((result) =>
                    {
                        Generate_settings_page(result);
                        Finalize_load_UI(rootfile_content, xml_doc);
                    });
            }
            else
            {
                document.getElementById('settings-tab').style.display = 'none';
                Finalize_load_UI(rootfile_content, xml_doc);
            }
        });
    });
}

/**
 * Finalizes loadin of user interface, then calls Load_side_menu().
 *
 * @param {Object} rootfile_content - Rootfile loaded with Read_from_DB() function.
 * @param {Document} xml_doc - Parsed rootfile content.
 */
function Finalize_load_UI(rootfile_content, xml_doc)
{
    if (readed_page == null)
    {
        let first_page_id = xml_doc.querySelector(`itemref`).getAttribute("idref");
        let first_page_href = xml_doc.getElementById(first_page_id).getAttribute("href");
        document.getElementById("page-name").textContent =
            `${sessionStorage.getItem("rootfile_dir")}${first_page_href}`;

        let element;
        element = xml_doc.querySelector('item[properties="contact"]');
        if(element != null)
        {
            let href_contact = element.getAttribute('href');
            document.getElementById('contact-tab').addEventListener('click', () =>
            {
                Change_page(href_contact, sessionStorage.getItem("rootfile_dir") + sessionStorage.getItem("rootfile_name"));
            });
        }
        else
        {
            document.getElementById('contact-tab').style.display = 'none';
        }

        element = xml_doc.querySelector('item[properties="index"]');
        if(element != null)
        {
            let href_index = element.getAttribute('href');
            document.getElementById('index-tab').addEventListener('click', () =>
            {
                Change_page(href_index, sessionStorage.getItem("rootfile_dir") + sessionStorage.getItem("rootfile_name"));
            });
        }
        else
        {
            document.getElementById('index-tab').style.display = 'none';
        }




        Read_from_DB(`${sessionStorage.getItem("rootfile_dir")}${first_page_href}`)
            .then((result) =>
            {
                Adjust_content(result.file_content).then((result) =>
                {
                    document.getElementById("page-name").textContent =
                        `${sessionStorage.getItem("rootfile_dir")}${first_page_href}`;
                    document.querySelector('#epub-display').srcdoc = result;
                    sessionStorage.setItem("cur_file",
                        `${sessionStorage.getItem("rootfile_dir")}${first_page_href}`);

                    Load_side_menu(rootfile_content);
                });
            });
    }
    else
    {
        Read_from_DB(readed_page).then((result) =>
        {
            if (result == null)
            {
                window.alert("Omlouváme se, požadovaná stránka nápovědy nebyla nalezena.");
            }
            else
            {
                Adjust_content(result.file_content).then((result) =>
                {
                    document.getElementById("page-name").textContent = readed_page;
                    document.querySelector('#epub-display').srcdoc = result;
                    sessionStorage.setItem("cur_file", readed_page);

                    let element;
                    element = xml_doc.querySelector('item[properties="contact"]');
                    if(element != null)
                    {
                        let href_contact = element.getAttribute('href');
                        document.getElementById('contact-tab').addEventListener('click', () =>
                        {
                            Change_page(href_contact, sessionStorage.getItem("rootfile_dir") +
                                sessionStorage.getItem("rootfile_name"));
                        });
                    }
                    else
                    {
                        document.getElementById('contact-tab').style.display = 'none';
                    }

                    element = xml_doc.querySelector('item[properties="index"]');
                    if(element != null)
                    {
                        let href_index = element.getAttribute('href');
                        document.getElementById('index-tab').addEventListener('click', () =>
                        {
                            Change_page(href_index, sessionStorage.getItem("rootfile_dir") +
                                sessionStorage.getItem("rootfile_name"));
                        });
                    }
                    else
                    {
                        document.getElementById('index-tab').style.display = 'none';
                    }


                    Load_side_menu(rootfile_content);
                });
            }
        });
    }
}

/**
 * Load side menu based on data of the main EPUB file.
 *
 * @param {Object} rootfile_content - Rootfile loaded with Read_from_DB() function.
 */
function Load_side_menu(rootfile_data)
{
    let parser = new DOMParser();
    let xml_doc = parser.parseFromString(rootfile_data.file_content, "text/xml");
    let element = xml_doc.querySelector('item[properties="nav"]');

    if (element != null)
    {
        let href = element.getAttribute('href');
        sessionStorage.setItem('nav_dir', href.replace(href.substr(href.lastIndexOf("/") + 1), ''));
        href = sessionStorage.getItem("rootfile_dir") + href;

        let pom = new URL("", `https://${document.domain}`).href;

        pom = new URL(href, pom);
        href = pom.pathname.substring(1);

        Read_from_DB(href).then(async (result) =>
        {
            let parser = new DOMParser();
            let xml_doc = parser.parseFromString(result.file_content, "text/xml");
            let generated_nav = document.createElement('ul');

            let original_nav = xml_doc.querySelector('nav[*|type="toc"] ol');

            if (window.secondary_epub_files != null)
            {
                for (let i = 1; i < window.secondary_epub_files.length; i++)
                {
                    await Read_from_DB('META-INF/container.xml', window.secondary_epub_files[i]).then(
                        async (result) =>
                        {
                            return new Promise((resolve, reject) =>
                            {
                                let parser = new DOMParser();
                                let xml_doc = parser.parseFromString(result.file_content, "text/xml");

                                let rootfile =
                                    xml_doc.querySelector("container rootfiles rootfile").getAttribute("full-path");

                                let rootfile_name = rootfile.substring(rootfile.lastIndexOf("/") + 1);
                                let rootfile_dir = rootfile.replace(rootfile_name, "");

                                resolve({"rootfile": rootfile, "rootfile_dir": rootfile_dir})
                            }).then(function (rootfile_data)
                            {
                                Read_from_DB(rootfile_data.rootfile, window.secondary_epub_files[i]).then(
                                    async (rootfile_content) =>
                                    {
                                        let parser = new DOMParser();
                                        let xml_doc = parser.parseFromString(rootfile_content.file_content, "text/xml");
                                        let element = xml_doc.querySelector('item[properties="nav"]');

                                        if (element != null)
                                        {
                                            let href = element.getAttribute('href');

                                            href = rootfile_data.rootfile_dir + href;

                                            let pom = new URL("", `https://${document.domain}`).href;

                                            pom = new URL(href, pom);
                                            href = pom.pathname.substring(1);

                                            await Read_from_DB(href, window.secondary_epub_files[i]).then(async (result) =>
                                            {
                                                let parser = new DOMParser();
                                                let xml_doc = parser.parseFromString(result.file_content, "text/xml");

                                                let original_nav = xml_doc.querySelector('nav[*|type="toc"] ol');

                                                let generated_children = Generate_submenu(original_nav.children,
                                                    window.secondary_epub_files[i]);

                                                let file_li = document.createElement("li");
                                                let details = document.createElement("details");
                                                let summary = document.createElement("summary");
                                                let span = document.createElement("span");
                                                span.textContent = window.secondary_epub_files[i];
                                                span.classList.add("nav-link");

                                                summary.appendChild(span);
                                                details.appendChild(summary);

                                                let file_ul = document.createElement("ul");
                                                file_ul.append(...generated_children);
                                                details.appendChild(file_ul);

                                                file_li.appendChild(details);
                                                generated_nav.append(file_li);
                                            });
                                        }
                                    });

                            });
                        })
                }

                let file_li = document.createElement("li");
                let details = document.createElement("details");
                details.open = true;
                let summary = document.createElement("summary");
                let span = document.createElement("span");
                span.textContent = window.db_name;
                span.classList.add("nav-link");

                summary.appendChild(span);
                details.appendChild(summary);

                let file_ul = document.createElement("ul");
                let generated_children = Generate_submenu(original_nav.children, window.db_name);
                file_ul.append(...generated_children);
                details.appendChild(file_ul);

                file_li.appendChild(details);
                generated_nav.append(file_li);
            }
            else
            {
                let generated_children = Generate_submenu(original_nav.children, window.db_name);
                generated_nav.append(...generated_children);
            }

            document.getElementById('main-navigation').appendChild(generated_nav);


            let selector;
            let selector_file = sessionStorage.getItem("cur_file").replace(sessionStorage.getItem("rootfile_dir"), "");
            selector_file = selector_file.replace(sessionStorage.getItem('nav_dir'), "");

            selector = `[data-href*='${selector_file}`;
            let hash = new URL(location.href).searchParams.get('hash');

            if (hash != null)
            {
                selector += `#${hash}']`;
            }
            else
            {
                selector += `']`;
            }

            let menu_spans = document.querySelectorAll('#main-navigation .highlited');
            for (let menu_span of menu_spans)
            {
                menu_span.classList.remove('highlited');
            }
            Highlight_menu_path(document.querySelector(selector));
        });
    }
}

/**
 * Recursive function for generation of one level of navigation.
 *
 * @param {Element} navigation - UL element from which should be navigation generateg.
 * @param {string} epub_file - Name of EPUB file the navigation is generated for.
 * @returns {[]} - Array of navigation elements.
 */
function Generate_submenu(navigation, epub_file)
{
    let generated_children = [];

    for (let li of navigation)
    {
        let generated_li = document.createElement('li');

        if (li.children.length == 2) // If LI has submenu.
        {
            let details = document.createElement('details');
            let summary = document.createElement('summary');

            let span = document.createElement('span');
            span.textContent = li.children[0].textContent;

            if (li.children[0].tagName.toLowerCase() == 'a')    // If span contains link.
            {
                span.addEventListener('click', () =>
                {
                    Change_page(li.children[0].getAttribute("href"), "cur_posittion",
                        false, epub_file);
                });
                span.classList.add('nav-link');
                span.setAttribute('data-href', li.children[0].getAttribute("href"));
                span.setAttribute('data-file', epub_file);
            }
            else
            {
                span.classList.add('nav-heading');
            }
            summary.appendChild(span);
            details.appendChild(summary);

            let ul = document.createElement('ul');
            let details_ul = Generate_submenu(li.children[1].children, epub_file);
            ul.append(...details_ul);

            details.appendChild(ul);

            generated_li.appendChild(details);
        }
        else
        {
            let span = document.createElement('span');
            span.textContent = li.children[0].textContent;
            span.classList.add('nav-link');

            if (li.children[0].tagName.toLowerCase() == 'a')
            {
                span.addEventListener('click', () =>
                {
                    Change_page(li.children[0].getAttribute("href"), "cur_posittion",
                        false, epub_file);
                });
                span.setAttribute('data-href', li.children[0].getAttribute("href"));
                span.setAttribute('data-file', epub_file);
            }

            generated_li.appendChild(span);
        }

        generated_children.push(generated_li);
    }

    return generated_children;
}

/**
 * Change displayed document in iframe. Also handles history records.
 *
 * @param {string} new_page - Name of the new documet.
 * @param {string} doc_path - Path related to the document.
 * @param {boolean} from_history - Shether the change was iniciated by popstate event (if true, history is not affected).
 * @param {string} new_file - The name of the database from which should be readed. Set to main EPUB file name by default.
 */
function Change_page(new_page, doc_path = "cur_posittion", from_history = false, new_file = "")
{
    let pom;

    if (doc_path == "cur_posittion")
    {
        pom = new URL(sessionStorage.getItem("cur_file"), `https://${document.domain}`).href;
    }
    else
    {
        pom = new URL(doc_path, `https://${document.domain}`).href;
    }

    pom = new URL(new_page, pom);
    new_page = pom.pathname.substring(1);

    sessionStorage.setItem("cur_hash", pom.hash);

    let search_param = [];

    const url_params = new URL(location.href).searchParams;
    if (new_file != "" && window.db_name != new_file && window.secondary_epub_files.length > 0)
    {
        search_param.push(`file=${new_file}`);

        let sec_files_par = window.secondary_epub_files;

        for (let i = 0; i < sec_files_par.length; i++)
        {
            if (sec_files_par[i] == new_file || sec_files_par[i] == window.db_name)
            {
                sec_files_par.splice(i);
            }
        }

        search_param.push(`readed_page=${new_page}`);

        sec_files_par.push(window.db_name);
        search_param.push(`secondary_files=${sec_files_par.join(',')}`);
        sec_files_par.unshift(new_file);
        window.secondary_epub_files = sec_files_par;

        window.db_name = new_file;

        if (pom.hash != "")
        {
            search_param.push(`hash=${pom.hash.substring(1)}`);
        }

        Read_from_DB('META-INF/container.xml', new_file).then(
            async (rootfile_doc) =>
            {
                let parser = new DOMParser();
                let xml_doc = parser.parseFromString(rootfile_doc.file_content, "text/xml");

                return new Promise((resolve, reject) =>
                {

                    let rootfile =
                        xml_doc.querySelector("container rootfiles rootfile").getAttribute("full-path");

                    let rootfile_name = rootfile.substring(rootfile.lastIndexOf("/") + 1);
                    let rootfile_dir = rootfile.replace(rootfile_name, "");
                    sessionStorage.setItem("rootfile_dir", rootfile.replace(rootfile_name, ""));
                    sessionStorage.setItem("rootfile_name", rootfile_name);


                    resolve({"rootfile": rootfile, "rootfile_dir": rootfile_dir})
                }).then(async function (rootfile_data)
                {
                    await Read_from_DB(rootfile_data.rootfile, window.db_name).then(
                        async (rootfile_content) =>
                        {
                            let parser = new DOMParser();
                            let xml_doc = parser.parseFromString(rootfile_content.file_content, "text/xml");

                            let documents_el = xml_doc.querySelectorAll(`manifest item`);
                            let document_types = {};

                            for (let doc of documents_el)
                            {
                                document_types[`${sessionStorage.getItem("rootfile_dir")}${doc.getAttribute("href")}`] =
                                    doc.getAttribute("media-type");
                            }

                            sessionStorage.setItem("document_types", JSON.stringify(document_types));

                            let element = xml_doc.querySelector('item[properties="nav"]');

                            if (element != null)
                            {
                                let href = element.getAttribute('href');
                                sessionStorage.setItem('nav_dir', href.replace(href.substr(href.lastIndexOf("/") + 1), ''));
                            }

                        });

                });
            })

    }
    else
    {
        if (url_params.get('file') != null)
        {
            search_param.push(`file=${url_params.get('file')}`);
        }
        search_param.push(`readed_page=${new_page}`);
        if (url_params.get('secondary_files') != null)
        {
            search_param.push(`secondary_files=${url_params.get('secondary_files')}`);
        }
        if (pom.hash != "")
        {
            search_param.push(`hash=${pom.hash.substring(1)}`);
        }
    }


    if (from_history == false)
    {
        history.pushState({"page": new_page + pom.hash, "file": new_file}, null, `?${search_param.join("&")}`);
    }

    let loaded_page = document.getElementById("page-name");
    loaded_page.textContent = new_page.replace(sessionStorage.getItem("rootfile_dir"), "");
    sessionStorage.setItem("cur_file", new_page);

    let selector;
    let selector_file = new_page.replace(sessionStorage.getItem("rootfile_dir"), "");
    selector_file = selector_file.replace(sessionStorage.getItem('nav_dir'), "");

    selector = `[data-href*='${selector_file}`;
    let hash = new URL(location.href).searchParams.get('hash');

    if (hash != null)
    {
        selector += `#${hash}']`;
    }
    else
    {
        selector += `']`;
    }
    selector += `[data-file='${window.db_name}']`;

    let menu_spans = document.querySelectorAll('#main-navigation .highlited');
    for (let menu_span of menu_spans)
    {
        menu_span.classList.remove('highlited');
    }
    Highlight_menu_path(document.querySelector(selector));

    Read_from_DB(new_page).then((result) =>
    {
        if (result == null)
        {
            window.alert("Omlouváme se, požadovaná stránka nápovědy nebyla nalezena.");
        }
        else
        {
            Adjust_content(result.file_content).then((result) =>
            {
                document.querySelector('#epub-display').srcdoc = result;
                Display_tab('epub-display');    // Ensure that iframe is displayed.
            })
        }
    });
}

/**
 * Highlight path to the displayed document in navigation.
 *
 * @param {Element} menu_link - Element to highlite.
 */
function Highlight_menu_path(menu_link)
{
    if (menu_link != null)
    {
        menu_link.classList.add('highlited');
        let details = menu_link.closest('details');
        if (details != null)
        {
            details.open = true;
            let span = details.querySelector('summary span');
            span.classList.add('highlited');
            Highlight_menu_path(details.parentElement);
        }
    }
}

/**
 * Function for adjusting HTML document. Transforms links based on their type (mainly to Base64) and evaluates
 * users settings.
 *
 * @param {string} html - HTML document to adjust.
 * @returns {Promise<string>} - Adjustit HTML document.
 */
function Adjust_content(html)
{
    return new Promise(async (resolve, reject) =>
    {
        var parser = new DOMParser();
        var xml_doc = parser.parseFromString(html, "text/xml");
        var href_el = xml_doc.querySelectorAll(`link[href]`);

        let changed_string = "";


        for (let cur_el of href_el)
        {
            let test_string = cur_el.getAttribute("href").toLowerCase();
            if (!test_string.includes("https") && !test_string.includes("http")) // If link is not external.
            {
                changed_string = cur_el.getAttribute("href").replace("../", "");    //  TO DO
                changed_string = changed_string.replace("./", "");

                cur_el.setAttribute("href", `data:text/css;base64,`);

                await Read_from_DB(`${sessionStorage.getItem("rootfile_dir")}${changed_string}`).then(async (result) =>
                {
                    var blob = new Blob(
                        [result.file_content],
                        {type: 'text/css'}
                    );
                    await Get_base64(blob).then((result) =>
                    {
                        cur_el.setAttribute("href", result);
                    })
                });
            }
        }

        href_el = xml_doc.querySelectorAll(`a[href]`);

        for (let cur_el of href_el)
        {
            let test_string = cur_el.getAttribute("href").toLowerCase();
            if (test_string.includes("https://") || test_string.includes("http://")) // If link is external.
            {
                cur_el.setAttribute("target", "_blank");
            }
        }

        href_el = xml_doc.querySelectorAll(`img[src]`);

        for (let cur_el of href_el)
        {
            let test_string = cur_el.getAttribute("src").toLowerCase();
            if (!test_string.includes("https") && !test_string.includes("http")) // If link is not external.
            {
                changed_string = cur_el.getAttribute("src").replace("../", "");    //  TO DO
                changed_string = changed_string.replace("./", "");

                await Read_from_DB(`${sessionStorage.getItem("rootfile_dir")}${changed_string}`).then((result) =>
                {
                    cur_el.setAttribute("src", `data:image/*;base64,${result.file_content}`);
                });
            }
        }

        href_el = xml_doc.querySelectorAll(`audio[src]`);

        for (let cur_el of href_el)
        {
            let test_string = cur_el.getAttribute("src").toLowerCase();
            if (!test_string.includes("https") && !test_string.includes("http")) // If link is not external.
            {
                changed_string = cur_el.getAttribute("src").replace("../", "");    //  TO DO
                changed_string = changed_string.replace("./", "");

                await Read_from_DB(`${sessionStorage.getItem("rootfile_dir")}${changed_string}`).then((result) =>
                {
                    cur_el.setAttribute("src", `data:audio/*;base64,${result.file_content}`);
                });
            }
        }

        href_el = xml_doc.querySelectorAll(`svg image`);

        for (let cur_el of href_el)
        {
            let href;

            if (cur_el.getAttribute("href") != null)
            {
                href = cur_el.getAttribute("href");
            }
            else
            {
                href = cur_el.getAttribute("xlink:href");
            }

            let test_string = href.toLowerCase();

            if (!test_string.includes("https") && !test_string.includes("http")) // If link is not external.
            {
                changed_string = href.replace("../", "");    //  TO DO
                changed_string = changed_string.replace("./", "");

                cur_el.removeAttribute("xlink:href");
                await Read_from_DB(`${changed_string}`).then((result) =>
                {
                    cur_el.setAttribute("href", `data:image/*;base64,${result.file_content}`);
                });
            }
        }

        if(window.epub_settings !== undefined)
        {
            let conditions = Object.keys(window.epub_settings);
            for(let condition of conditions)
            {
                let elements = xml_doc.querySelectorAll(`[data-${condition}]`);

                for (let element of elements)
                {
                    let cond_values = element.getAttribute(`data-${condition}`).split(' ');

                    if(cond_values.includes(window.epub_settings[condition]) == false)
                    {
                        element.style.display = 'none';
                    }
                }
            }
        }


        let higl_style_link = document.createElement("link");
        higl_style_link.href = "highlightjs/default.css";
        higl_style_link.rel = "stylesheet";
        higl_style_link.type = "text/css";

        xml_doc.querySelector('head').appendChild(higl_style_link); // Add link to highlight style.

        var oSerializer = new XMLSerializer();
        resolve(oSerializer.serializeToString(xml_doc));
    });
}

/**
 * Initiate search of a new expression and write results.
 */
function Find_and_write_search_results()
{
    let expression = document.getElementById('search-input').value;
    let search_res = document.getElementById('search-results');
    search_res.textContent = "";

    let h2 = document.createElement("h2");
    h2.textContent = "Výsledky vyhledávání";
    search_res.append(h2);

    Search_expression(expression).then((results) =>
    {
        results = results.sort(function (a, b)  // Order by priority.
        {
            return a.priority - b.priority;
        });


        if(window.secondary_epub_files != null)
        {
            for (let i = 0; i < window.secondary_epub_files.length; i++)
            {
                let h2 = document.createElement("h2");
                h2.textContent = window.secondary_epub_files[i];
                search_res.append(h2);

                let ul = document.createElement("ul");
                ul.style.paddingLeft = "25px";

                for (let result of results)
                {
                    if(window.secondary_epub_files[i] != result.file)
                    {
                        continue;
                    }

                    let li = document.createElement("li");
                    let div = document.createElement("div");
                    div.classList.add("search-result");
                    div.addEventListener('click', () =>
                    {
                        Change_page(result.key, "", false, result.file);
                    });
                    let h3 = document.createElement("h3");
                    let info_div = document.createElement("div");

                    h3.textContent = result.title;
                    div.appendChild(h3);
                    info_div.textContent = result.description;
                    div.appendChild(info_div);
                    li.appendChild(div);
                    ul.appendChild(li);
                }

                search_res.appendChild(ul);
            }
        }
        else
        {
            let ul = document.createElement("ul");

            for (let result of results)
            {
                let li = document.createElement("li");
                let div = document.createElement("div");
                div.classList.add("search-result");
                div.addEventListener('click', () =>
                {
                    Change_page(result.key, "", false, result.file);
                });
                let h3 = document.createElement("h3");
                let info_div = document.createElement("div");

                h3.textContent = result.title;
                div.appendChild(h3);
                info_div.textContent = result.description;
                div.appendChild(info_div);
                li.appendChild(div);
                ul.appendChild(li);
            }

            search_res.appendChild(ul);
        }
    });
}

/**
 * Find searched expression in all documents.
 *
 * @param {string} expression - Searched expression.
 * @returns {Promise<[]>} - Array of objects with results generated by Generate_search_result().
 */
async function Search_expression(expression)
{
    return new Promise(async (resolve, reject) =>
    {
        Display_tab("search-div");

        let search_results = [];

        let stop_words;

        let Load_stop_words = function ()
        {
            return new Promise(async (resolve) =>
            {
                let http_req = new XMLHttpRequest();
                http_req.overrideMimeType("application/json");
                http_req.open('GET', 'stop_words.json', true);
                http_req.onreadystatechange = await function ()
                {
                    if (this.readyState == this.DONE && this.status == "200")
                    {
                        stop_words = this.responseText;
                        resolve();
                    }
                };
                http_req.send(null);
            });
        }

        await Load_stop_words();

        let orig_expression = expression;

        // Remove stop words from expression.
        for (let lang of stop_words)
        {
            for (let i = 0; i < lang.length; i++)
            {
                expression = expression.replace(` ${lang[i]} `, '');

                if (expression.startsWith(`${lang[i]} `))
                {
                    expression = expression.substring(`${lang[i]} `.length, expression.length);
                }

                if (expression.endsWith(` ${lang[i]}`))
                {
                    expression = expression.substring(0, expression.lastIndexOf(` ${lang[i]}`));
                }
            }
        }

        if (expression == "")
        {
            expression = orig_expression;   // If the expression was cleared completely, use he original one.
        }

        expression = expression.toLowerCase();
        expression = expression.replace(/\s\s+/g, ' ').trim();  //Remove multiple, initial and trailing spaces.
        let dictionary = {
            "á": "a", "ä": "a", "č": "c", "ď": "d", "é": "e", "ě": "e", "ë": "e", "í": "i", "ï": "i", "ľ": "l",
            "ĺ": "l", "ň": "n", "ń": "n", "ó": "o", "ö": "o", "ř": "r", "ŕ": "r", "š": "s", "ś": "s", "ť": "t",
            "ú": "u", "ů": "u", "ü": "u", "ý": "y", "ÿ": "y", "ž": "z", "ź": "z"
        };

        expression = expression.strtr(dictionary);

        let words_to_search = expression.split(' ');

        async function Search_in_document(key, db_name)
        {
            await Read_from_DB(key, db_name).then((result) =>
            {
                if (result == null)
                {
                    alert('Došlo k chybě při načtení souboru.');
                }
                if (db_name == "" || db_name == undefined)
                {
                    db_name = window.db_name;
                }

                let parser = new DOMParser();

                let translated_doc = result.file_content.toLowerCase();
                translated_doc = translated_doc.strtr(dictionary);

                let xml_doc = parser.parseFromString(translated_doc, "text/xml");

                let keywords = xml_doc.evaluate('//h:meta[@name="keywords"]/@content', xml_doc,
                    ns_resolve, XPathResult.STRING_TYPE, null).stringValue;

                let found_priority = false;

                for (let i = 0; i < words_to_search.length; i++)
                {
                    if (keywords.search(RegExp(words_to_search[i], 'i')) > -1)
                    {
                        found_priority = 1;
                        break;
                    }

                    if ((found_priority === false || found_priority > 2) &&
                        (xml_doc.evaluate(`count(//h:h1[contains(text(),'${words_to_search[i]}')]|` +
                            `//h:h2[contains(text(),'${words_to_search[i]}')]|` +
                            `//h:h3[contains(text(),'${words_to_search[i]}')]|` +
                            `//h:h4[contains(text(),'${words_to_search[i]}')]|` +
                            `//h:h5[contains(text(),'${words_to_search[i]}')]|` +
                            `//h:h6[contains(text(),'${words_to_search[i]}')])`,
                            xml_doc, ns_resolve, XPathResult.NUMBER_TYPE, null).numberValue > 0))
                    {
                        found_priority = 2;
                    }

                    if ((found_priority === false) &&
                        (xml_doc.evaluate(`count(//*[contains(text(),'${words_to_search[i]}')])`,
                            xml_doc, ns_resolve, XPathResult.NUMBER_TYPE, null).numberValue > 0))
                    {
                        found_priority = 3;
                    }
                }

                if (typeof found_priority !== "boolean")
                {
                    let xml_doc_orig = parser.parseFromString(result.file_content, "text/xml");
                    search_results.push(Generate_search_result(key, found_priority, xml_doc_orig,
                        db_name, ns_resolve));
                    return;
                }
            });
        }

        let document_types = JSON.parse(sessionStorage.getItem("document_types"));

        let ns_resolve = function (prefix)
        {
            var ns = {'h': 'http://www.w3.org/1999/xhtml'};
            return ns[prefix] || null;
        };

        let documents_to_parse = [];

        Object.keys(document_types).forEach((key) =>
        {
            if (document_types[key] == "application/xhtml+xml")
            {
                documents_to_parse.push(key);
            }
        });

        for (let parsed_doc of documents_to_parse)
        {
            await Search_in_document(parsed_doc);
        }


        if (window.secondary_epub_files != null)
        {
            for (let i = 1; i < window.secondary_epub_files.length; i++)
            {
                await Read_from_DB('META-INF/container.xml', window.secondary_epub_files[i]).then(
                    async (result) =>
                    {
                        return new Promise((resolve, reject) =>
                        {
                            let parser = new DOMParser();
                            let xml_doc = parser.parseFromString(result.file_content, "text/xml");

                            let rootfile =
                                xml_doc.querySelector("container rootfiles rootfile").getAttribute("full-path");

                            let rootfile_name = rootfile.substring(rootfile.lastIndexOf("/") + 1);
                            let rootfile_dir = rootfile.replace(rootfile_name, "");

                            resolve({"rootfile": rootfile, "rootfile_dir": rootfile_dir})
                        }).then(async function (rootfile_data)
                        {
                            await Read_from_DB(rootfile_data.rootfile, window.secondary_epub_files[i]).then(
                                async (rootfile_content) =>
                                {
                                    let parser = new DOMParser();

                                    let xml_doc = parser.parseFromString(rootfile_content.file_content, "text/xml");

                                    let documents_el = xml_doc.querySelectorAll(`manifest item`);
                                    let document_types = {};

                                    for (let doc of documents_el)
                                    {
                                        let href = doc.getAttribute('href');

                                        href = rootfile_data.rootfile_dir + href;

                                        let pom = new URL("", `https://${document.domain}`).href;

                                        pom = new URL(href, pom);
                                        href = pom.pathname.substring(1);

                                        document_types[href] = doc.getAttribute("media-type");
                                    }

                                    let documents_to_parse = [];

                                    Object.keys(document_types).forEach((key) =>
                                    {
                                        if (document_types[key] == "application/xhtml+xml")
                                        {
                                            documents_to_parse.push(key);
                                        }
                                    });

                                    for (let parsed_doc of documents_to_parse)
                                    {
                                        await Search_in_document(parsed_doc, window.secondary_epub_files[i]);
                                    }

                                });

                        });
                    })
            }
        }
        resolve(search_results);
    });
}

/**
 *  Process search result into object.
 *
 * @param {string} key - Name of find document.
 * @param {number} priority - Priority of search.
 * @param {Document} xml_doc - Parsed document content.
 * @param {string} file - Name of EPUB file the find document belongs to.
 * @param {XPathNSResolver} ns_resolve - Resolver of namespaces for xml_doc.
 * @returns {Object} - Generated search result.
 */
function Generate_search_result(key, priority, xml_doc, file, ns_resolve)
{
    let title = xml_doc.evaluate('//h:title/text()', xml_doc, ns_resolve, XPathResult.STRING_TYPE,
        null).stringValue;
    let desc = xml_doc.evaluate('//h:meta[@name="description"]/@content', xml_doc, ns_resolve,
        XPathResult.STRING_TYPE, null).stringValue;
    return {"key": key, "priority": priority, "title": title, "description": desc, "file": file};
}

/**
 * Open indexedDB database with specified name or create a new one if does not exists.
 *
 * @param {string} [db_name] - The name of the database.
 * @returns {Promise<boolean>} - Returns true, if database existed, false if it was newly created.
 */
function Open_DB(db_name = "")
{
    return new Promise(async (resolve, reject) =>
    {
        if (db_name == "")
        {
            db_name = window.db_name;
        }
        let request = indexedDB.open(db_name, 3);

        let existed = true;

        request.onsuccess = async function (evt)
        {
            db[db_name] = request.result;
            resolve(existed)
        };

        request.onerror = function (evt)
        {
            console.error("openDb:", evt.target.errorCode);
        };

        request.onupgradeneeded = function (evt)
        {
            existed = false;
            let store = evt.currentTarget.result.createObjectStore('files', {keyPath: 'file_name'});
            try
            {
                Clear_data_from_DB();
            }
            catch (e)
            {
                console.log('Nic ke smazání.');
            }

        };
    });
}

/**
 * Convert name and content of a file to JSON and save it to database.
 *
 * @param {string} file_name - Name of saved file.
 * @param file_content - Content to save.
 * @param {string} [db_name] - The name of the database in which should be the file saved.
 */
function Save_file_to_DB(file_name, file_content, db_name = '')
{
    Save_to_DB({"file_name": file_name, "file_content": file_content}, db_name);
}

/**
 * Save object to database.
 *
 * @param data - Data to save.
 * @param {string} [db_name] - The name of the database in which should be the file saved. Set to main EPUB file name by default.
 */
function Save_to_DB(data, db_name = '')
{
    if (db_name == "")
    {
        db_name = window.db_name;
    }
    let request = db[db_name].transaction('files', 'readwrite').objectStore('files').add(data);

    request.onsuccess = function (event)
    {
        console.log("Záznam uložen");
    };

    request.onerror = function (event)
    {
        console.log("Záznam už existuje.");
    }
}

/**
 * Read data from database.
 *
 * @param key - Key of readed database record.
 * @param {string} db_name - The name of the database from which should be readed. Set to main EPUB file name by default.
 * @returns {Promise<Object>} - Data loaded drom database, null on failure.
 */
function Read_from_DB(key, db_name = "")
{
    return new Promise(async (resolve, reject) =>
    {
        if (db_name == "")
        {
            db_name = window.db_name
        }
        let transaction = db[db_name].transaction("files");
        let request = transaction.objectStore("files").get(key);

        request.onerror = function (event)
        {
            alert("Nebylo možné načíst data.");
        };

        request.onsuccess = async function (event)
        {
            if (request.result)
            {
                resolve(request.result);
            }
            else
            {
                resolve(null);  // Data not found.
            }
        };
    });
}

/**
 * Deletes all data from database.
 *
 * @param {string} db_name - The name of the database, which should be cleared. Set to main EPUB file name by default.
 */
function Clear_data_from_DB(db_name = "")
{
    if (db_name == "")
    {
        db_name = window.db_name;
    }
    let transaction = db[db_name].transaction("files", "readwrite");
    let store = transaction.objectStore("files");
    let request = store.clear();

    request.onsuccess = function (event)
    {
        console.log("Data smazána.");
    }
}

/**
 * Converts file to Base64 string.
 *
 * @param {File} file - File to convert.
 * @returns {Promise<string>} - Base64 string.
 */
function Get_base64(file)
{
    const reader = new FileReader();
    return new Promise((resolve) =>
    {
        reader.onload = (event) =>
        {
            resolve(event.target.result)
        };
        reader.readAsDataURL(file);
    });
}

/**
 * Generates settings tab.
 *
 * @param {string} xml_settings - File content loaded with Read_from_DB().
 */
function Generate_settings_page(xml_settings)
{
    let settings_page = document.getElementById('settings-div');

    let title = document.createElement('h2');
    title.textContent = 'Nastavení';
    settings_page.append(title);

    let parser = new DOMParser();
    let xml_doc = parser.parseFromString(xml_settings.file_content,"text/xml");
    let conditions = xml_doc.getElementsByTagName("user_profile")[0].children;

    for(let condition of conditions)
    {
        let div = document.createElement('div');
        div.classList.add('settings-par');

        let id = condition.getElementsByTagName('name')[0].textContent;

        let label = document.createElement('label');
        label.textContent = condition.getElementsByTagName('title')[0].textContent;
        label.setAttribute('title', condition.getElementsByTagName('description')[0].textContent);
        label.setAttribute('for', id);
        div.appendChild(label);


        let inner_div = document.createElement('div');

        let select = document.createElement('select');
        select.name = id;
        select.id = id;

        for(let value of condition.getElementsByTagName('values')[0].children)
        {
            let option = document.createElement('option');
            option.value = value.textContent;
            option.textContent = value.textContent;
            select.appendChild(option);
            inner_div.appendChild(select);
        }

        div.appendChild(inner_div);
        settings_page.appendChild(div);
    }

    let submit_div = document.createElement('div');
    submit_div.classList.add('submit');
    let button = document.createElement('button');
    button.textContent = "Uložit nastavení";
    button.addEventListener('click', Genrate_settings);
    submit_div.appendChild(button);
    settings_page.appendChild(submit_div);
}

/**
 * Generate abd save user settings.
 */
function Genrate_settings()
{
    let inputs = document.querySelectorAll('#settings-div div div [name]');
    let setting = {};
    for (let element of inputs)
    {
        setting[element.getAttribute('name')] = element.value;
    }

    window.epub_settings = setting;
    Save_file_to_DB('USER_SETTINGS', JSON.stringify(setting));
    alert('Nastavení uloženo.');
    Change_page(sessionStorage.getItem('cur_file'), '');
}

/**
 * Switches curently displayed tab.
 *
 * @param name - ID of the new tab which should be displayed.
 */
function Display_tab(name)
{
    let active_tab = document.querySelector('[data-display="flex"]');
    if (active_tab.id == name && name != 'epub-display')
    {
        let elements = document.querySelectorAll('[data-display]');
        for (let element of elements)
        {
            element.setAttribute('data-display', 'none');
        }

        document.getElementById('epub-display').setAttribute('data-display', 'flex');
    }
    else if (active_tab.id != name)
    {
        let elements = document.querySelectorAll('[data-display]');
        for (let element of elements)
        {
            element.setAttribute('data-display', 'none');
        }

        document.getElementById(name).setAttribute('data-display', 'flex');
    }
}

/**
 * strtr() for JavaScript
 * Translate characters or replace substrings.
 *
 * (Edit: Changed to work globally - Jakub Šafránek)
 *
 * @author Dmitry Sheiko
 * @version strtr.js, v 1.0.1, edited
 * @license MIT
 * @copyright (c) Dmitry Sheiko http://dsheiko.com
 **/
String.prototype.strtr = function (dic)
{
    const str = this.toString(),
        makeToken = (inx) => `{{###~${inx}~###}}`,

        tokens = Object.keys(dic)
            .map((key, inx) => ({
                key,
                val: dic[key],
                token: makeToken(inx)
            })),

        tokenizedStr = tokens.reduce((carry, entry) =>
            carry.replace(new RegExp(entry.key, 'g'), entry.token), str);

    return tokens.reduce((carry, entry) =>
        carry.replace(new RegExp(entry.token, 'g'), entry.val), tokenizedStr);
};