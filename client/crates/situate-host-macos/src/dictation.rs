use std::{
    ffi::{CStr, CString},
    path::Path,
    sync::OnceLock,
};

static CALLBACK: OnceLock<fn(&str)> = OnceLock::new();

unsafe extern "C" {
    fn situate_dictation_setup(
        path: *const std::ffi::c_char,
        library: *const std::ffi::c_char,
        loader: *const std::ffi::c_char,
        source: *const std::ffi::c_char,
        callback: extern "C" fn(*const std::ffi::c_char),
    );
    fn situate_dictation_command(command: *const std::ffi::c_char, id: *const std::ffi::c_char);
}
pub fn command(action: &str, id: &str) {
    let action = CString::new(action).unwrap();
    let id = CString::new(id).unwrap();
    unsafe { situate_dictation_command(action.as_ptr(), id.as_ptr()) };
}

extern "C" fn receive(data: *const std::ffi::c_char) {
    // Swift owns the string for the duration of this callback.
    let data = unsafe { CStr::from_ptr(data) };
    if let (Ok(event), Some(callback)) = (data.to_str(), CALLBACK.get()) {
        callback(event);
    }
}

pub fn setup(directory: &Path, library: &Path, loader: &Path, source: &str, callback: fn(&str)) {
    let _ = CALLBACK.set(callback);
    let (Ok(directory), Ok(library), Ok(loader), Ok(source)) = (
        CString::new(directory.to_string_lossy().as_bytes()),
        CString::new(library.to_string_lossy().as_bytes()),
        CString::new(loader.to_string_lossy().as_bytes()),
        CString::new(source),
    ) else {
        return;
    };
    unsafe {
        situate_dictation_setup(
            directory.as_ptr(),
            library.as_ptr(),
            loader.as_ptr(),
            source.as_ptr(),
            receive,
        )
    };
}
