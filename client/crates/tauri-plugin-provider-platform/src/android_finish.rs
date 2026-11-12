use jni::{
    JNIEnv, JavaVM,
    objects::{GlobalRef, JClass, JValue},
    sys::{JNI_FALSE, JNI_TRUE, jboolean},
};
use std::sync::OnceLock;

struct Bridge {
    vm: JavaVM,
    class: GlobalRef,
}
static BRIDGE: OnceLock<Bridge> = OnceLock::new();
const FAILURE: &str = "native.ai.browser.openFailed";

#[unsafe(no_mangle)]
pub extern "system" fn Java_dev_situate_providers_ProviderAuthNativeBridge_register(
    env: JNIEnv<'_>,
    class: JClass<'_>,
) -> jboolean {
    let result = (|| -> Result<(), jni::errors::Error> {
        let bridge = Bridge {
            vm: env.get_java_vm()?,
            class: env.new_global_ref(class)?,
        };
        let _ = BRIDGE.set(bridge);
        Ok(())
    })();
    if result.is_err() {
        let _ = env.exception_clear();
        JNI_FALSE
    } else {
        JNI_TRUE
    }
}

pub(super) fn finish(attempt_id: &str) -> Result<(), String> {
    let bridge = BRIDGE.get().ok_or_else(|| FAILURE.to_string())?;
    let mut env = bridge
        .vm
        .attach_current_thread()
        .map_err(|_| FAILURE.to_string())?;
    let result = (|| -> Result<bool, jni::errors::Error> {
        let id = env.new_string(attempt_id)?;
        let class: &JClass<'_> = bridge.class.as_obj().into();
        env.call_static_method(
            class,
            "finish",
            "(Ljava/lang/String;)Z",
            &[JValue::Object(&id)],
        )?
        .z()
    })();
    if result.is_err() {
        let _ = env.exception_clear();
    }
    match result {
        Ok(true) => Ok(()),
        _ => Err(FAILURE.into()),
    }
}
